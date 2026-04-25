// Worker entrypoint — routing and orchestration.
// Routes:
//   OPTIONS *            → CORS preflight
//   GET /api/chronicle   → resolver → cache → parallel fetch → timeline → response
//   GET /api/chronicle?stream=1 → SSE streaming with progress feedback
//   * (everything else)  → env.ASSETS.fetch(request) — SPA static assets

import { resolveInput } from "./resolver"
import { fetchMempool } from "./agents/mempool"
import { fetchOrdinals } from "./agents/ordinals"
import { scrapeXMentions } from "./agents/xsearch"
import { buildTimeline } from "./timeline"
import { cacheGet, cachePut } from "./cache"
import type { InscriptionMeta } from "../app/lib/types"

export interface Env {
  CHRONICLES_KV: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ENVIRONMENT: string
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS })
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      return handleApi(url, env)
    }

    // Serve static assets (SPA fallback handled by wrangler.jsonc config)
    return env.ASSETS.fetch(request)
  },
}

async function handleApi(url: URL, env: Env): Promise<Response> {
  // GET /api/chronicle?id=<inscription_id_or_number_or_address>&stream=1
  if (url.pathname === "/api/chronicle") {
    const raw = url.searchParams.get("id")
    if (!raw) {
      return jsonResponse({ error: "id parameter is required" }, 400)
    }

    const useStream = url.searchParams.get("stream") === "1"

    try {
      const resolved = await resolveInput(raw)

      // Address → return list of inscription IDs for the client to choose
      if (resolved.type === "address") {
        return jsonResponse({ 
          error: "Address lookup is temporarily disabled. A decentralized UTXO indexer is required to resolve addresses to inscriptions without paid APIs." 
        }, 501)
      }

      const id = resolved.value

      // Cache check (only for non-streaming — streaming always scans fresh for progress)
      if (!useStream) {
        const cached = await cacheGet(env.CHRONICLES_KV, id)
        if (cached) {
          return jsonResponse({ ...cached, from_cache: true })
        }
      }

      // Streaming mode: SSE with progress feedback
      if (useStream) {
        return handleStreamingChronicle(id, env)
      }

      // Standard mode: JSON response (backward compatible)
      return handleStandardChronicle(id, env)
    } catch (err) {
      console.error("Chronicle API error:", err)
      const message = err instanceof Error ? err.message : "Internal error"
      const status = message.includes("not found") ? 404 : 500
      return jsonResponse({ error: message }, status)
    }
  }

  return jsonResponse({ error: "Not found" }, 404)
}

// --- Standard JSON response (backward compatible) ---

async function handleStandardChronicle(id: string, env: Env): Promise<Response> {
  // 1. Fetch inscription metadata
  let meta: InscriptionMeta
  try {
    meta = await fetchOrdinals.inscription(id)
  } catch {
    return jsonResponse({ error: "Inscription not found" }, 404)
  }

  // 2. Parallel fetch for transfers and mentions
  const [transfers, xMentions] = await Promise.allSettled([
    fetchMempool.traceForward(meta.genesis_txid, meta.genesis_vout, { limit: 30 }),
    scrapeXMentions(id),
  ])

  const enrichedTransfers = transfers.status === "fulfilled" ? transfers.value : []
  const mentions = xMentions.status === "fulfilled" ? xMentions.value : []

  // 3. Build timeline
  const events = buildTimeline(meta, enrichedTransfers, mentions)

  const chronicle = {
    inscription_id: id,
    meta,
    events,
    cached_at: new Date().toISOString(),
  }

  // Cache (fire-and-forget)
  try {
    await cachePut(env.CHRONICLES_KV, id, chronicle)
  } catch (cacheErr) {
    console.error("Cache write failed:", cacheErr)
  }

  return jsonResponse(chronicle)
}

// --- SSE streaming response with progress ---

async function handleStreamingChronicle(id: string, env: Env): Promise<Response> {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const sendEvent = async (type: string, data: unknown) => {
    try {
      await writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // Writer may be closed if client disconnected
    }
  }

  // Run the pipeline in background, sending progress events
  const pipeline = (async () => {
    try {
      // Phase 1: Metadata
      await sendEvent("progress", {
        phase: "metadata",
        step: 1,
        description: "Fetching inscription data from ordinals.com…",
      })

      let meta: InscriptionMeta
      try {
        meta = await fetchOrdinals.inscription(id)
      } catch {
        await sendEvent("error", { message: "Inscription not found" })
        return
      }

      await sendEvent("progress", {
        phase: "metadata",
        step: 2,
        description: `Found inscription #${meta.inscription_number} · sat #${meta.sat}`,
      })

      // Phase 2: Forward transfer tracking with progress
      await sendEvent("progress", {
        phase: "transfers",
        step: 0,
        description: "Starting forward transfer scan via mempool.space…",
      })

      let transferCount = 0
      const transfers = await fetchMempool.traceForward(meta.genesis_txid, meta.genesis_vout, {
        limit: 30,
        delayMs: 150,
        onProgress: async (step, desc) => {
          transferCount = step
          await sendEvent("progress", {
            phase: "transfers",
            step,
            description: desc,
          })
        },
      })

      await sendEvent("progress", {
        phase: "transfers",
        step: transferCount,
        description: `Found ${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} (${transfers.filter(t => t.is_sale).length} sale${transfers.filter(t => t.is_sale).length !== 1 ? "s" : ""})`,
      })

      // Phase 3: X mentions
      await sendEvent("progress", {
        phase: "mentions",
        step: 1,
        description: "Searching for X mentions…",
      })

      let mentions: Awaited<ReturnType<typeof scrapeXMentions>> = []
      try {
        mentions = await scrapeXMentions(id)
      } catch {
        // X mentions failure is non-blocking
      }

      // Phase 4: Build timeline
      await sendEvent("progress", {
        phase: "complete",
        step: 1,
        description: "Building timeline…",
      })

      const events = buildTimeline(meta, transfers, mentions)

      const chronicle = {
        inscription_id: id,
        meta,
        events,
        cached_at: new Date().toISOString(),
      }

      // Cache (fire-and-forget)
      try {
        await cachePut(env.CHRONICLES_KV, id, chronicle)
      } catch {
        // Cache failure is non-blocking
      }

      // Send final result
      await sendEvent("result", chronicle)
    } catch (err) {
      await sendEvent("error", {
        message: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      try {
        await writer.close()
      } catch {
        // Already closed
      }
    }
  })()

  // Ensure the pipeline runs to completion even after returning the response
  // In Cloudflare Workers, use waitUntil if available; otherwise the stream keeps the connection alive
  void pipeline

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}
