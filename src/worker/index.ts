// Worker entrypoint — routing and orchestration.
// Routes:
//   OPTIONS *            → CORS preflight
//   GET /api/chronicle   → resolver → cache → parallel fetch → timeline → response
//   GET /api/chronicle?stream=1 → SSE streaming with progress feedback
//   * (everything else)  → env.ASSETS.fetch(request) — SPA static assets

import { resolveInput } from "./resolver"
import { cacheGet, cachePut } from "./cache"
import { db } from "./db"
import { persistRawEvents } from "./wiki/persistEvents"
import { handleWikiRoute } from "./routes/wiki"
import { fetchUnisat } from "./agents/unisat"

import {
  fetchMetadata,
  parallelFetch,
  dependentFetch,
  enrichment,
  buildOutput,
} from "./pipeline/phases"
import { emptyCollectorSignals } from "./pipeline/defaults"
import type {
  ChronicleState,
  DiagnosticsContext,
  ProgressCallback,
} from "./pipeline/types"

export interface Env {
  CHRONICLES_KV: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ENVIRONMENT: string
  UNISAT_API_KEY?: string
  DB?: D1Database
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function newRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function initState(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext,
  lite: boolean,
  onProgress?: ProgressCallback
): ChronicleState {
  return {
    inscriptionId: id,
    env: {
      CHRONICLES_KV: env.CHRONICLES_KV,
      UNISAT_API_KEY: env.UNISAT_API_KEY,
      DB: env.DB,
    },
    diagnostics,
    lite,
    onProgress,
    meta: null,
    cborTraits: null,
    transfers: [],
    collectionData: null,
    genesisTxResult: null,
    genesisTxFetched: false,
    transfersFetched: false,
    mentions: [],
    collectorSignals: emptyCollectorSignals(),
    mentionSourceCatalog: [],
    mentionDebugInfo: undefined,
    webResearch: null,
    unisatEnrichment: null,
    rarity: null,
    validation: null,
    events: [],
    sourceCatalog: [],
    chronicle: null,
    trace: {
      request_id: diagnostics.requestId,
      inscription_id: id,
      phases: [],
      total_duration_ms: 0,
    },
  }
}

async function runPipeline(state: ChronicleState): Promise<ChronicleState> {
  state = await fetchMetadata(state)
  state = await parallelFetch(state)
  state = await dependentFetch(state)
  state = await enrichment(state)
  state = await buildOutput(state)
  return state
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
      return handleApi(request, url, env)
    }

    // Serve static assets (SPA fallback handled by wrangler.jsonc config)
    return env.ASSETS.fetch(request)
  },
}

async function handleApi(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  if (url.pathname.startsWith("/api/wiki")) {
    return handleWikiRoute(request, env)
  }

  // GET /api/chronicle?id=<inscription_id_or_number_or_address>&stream=1
  if (url.pathname === "/api/chronicle") {
    const raw = url.searchParams.get("id")
    if (!raw) {
      return jsonResponse({ error: "id parameter is required" }, 400)
    }

    const useStream = url.searchParams.get("stream") === "1"
    const debug = url.searchParams.get("debug") === "1"
    const lite = url.searchParams.get("lite") === "1"

    try {
      const resolved = await resolveInput(raw)

      if (resolved.type === "address") {
        if (!env.UNISAT_API_KEY) {
          return jsonResponse(
            {
              error:
                "Address lookup requires a UniSat API key. Please configure UNISAT_API_KEY in the worker environment.",
            },
            501
          )
        }

        const cursor = Number.parseInt(url.searchParams.get("cursor") ?? "0", 10)
        const size = Number.parseInt(url.searchParams.get("size") ?? "48", 10)
        
        const page = await fetchUnisat.addressInscriptions(resolved.value, env.UNISAT_API_KEY, cursor, size)
        
        if (!page) {
           return jsonResponse({
            type: "address",
            address: resolved.value,
            inscriptions: [],
            total: 0,
            cursor: 0,
          })
        }

        return jsonResponse({
          type: "address",
          address: resolved.value,
          inscriptions: page.inscription.map(i => ({
            id: i.inscriptionId,
            number: i.inscriptionNumber,
            content_type: i.contentType,
            content_url: `https://ordinals.com/content/${i.inscriptionId}`,
          })),
          total: page.total,
          cursor: page.cursor,
        })
      }

      const id = resolved.value
      const route: DiagnosticsContext["route"] = useStream
        ? "stream"
        : "standard"
      const diagnostics: DiagnosticsContext = {
        debug,
        requestId: newRequestId(),
        route,
        inscriptionId: id,
      }

      // Cache check (only for non-streaming)
      if (!useStream && !debug) {
        const cached = await cacheGet(env.CHRONICLES_KV, id)
        if (cached) {
          return jsonResponse({ ...cached, from_cache: true })
        }
      }

      // Streaming mode: SSE with progress feedback
      if (useStream) {
        return handleStreamingChronicle(id, env, diagnostics)
      }

      // Standard mode: JSON response (backward compatible)
      return handleStandardChronicle(id, env, diagnostics, lite)
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

async function handleStandardChronicle(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext,
  lite?: boolean
): Promise<Response> {
  const state = initState(id, env, diagnostics, !!lite)
  try {
    const result = await runPipeline(state)
    if (!result.chronicle) {
      return jsonResponse({ error: "Pipeline produced no output" }, 500)
    }

    // Persist + cache (non-blocking)
    if (env.DB) {
      void persistRawEvents(env, id, result.events).then((r) => {
        if (!r.ok) console.warn(`Raw events persistence skipped: ${r.status}`)
      })
    }

    if (!lite) {
      try {
        await cachePut(env.CHRONICLES_KV, id, result.chronicle)
      } catch (cacheErr) {
        console.error("Cache write failed:", cacheErr)
      }
    }

    // Validation to DB (non-blocking)
    if (result.validation) {
      try {
        await db.putValidation(env.CHRONICLES_KV, {
          inscription_id: id,
          ...result.validation,
        })
      } catch {
        // non-blocking
      }
    }

    return jsonResponse(result.chronicle)
  } catch (err) {
    console.error("Pipeline execution failed:", err)
    return jsonResponse({ error: "Inscription not found" }, 404)
  }
}

async function handleStreamingChronicle(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext
): Promise<Response> {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const sendEvent = async (type: string, data: unknown) => {
    try {
      await writer.write(
        encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch {
      // Writer may be closed if client disconnected
    }
  }

  const onProgress: ProgressCallback = async (phase, step, description) => {
    await sendEvent("progress", { phase, step, description })
  }

  const pipeline = (async () => {
    try {
      const state = initState(id, env, diagnostics, false, onProgress)
      const result = await runPipeline(state)

      if (!result.chronicle) {
        await sendEvent("error", { message: "Pipeline produced no output" })
        return
      }

      // Persist + cache (non-blocking)
      if (env.DB) {
        void persistRawEvents(env, id, result.events).then((r) => {
          if (!r.ok) {
            console.warn(`Raw events persistence skipped (stream): ${r.status}`)
          }
        })
      }

      try {
        await cachePut(env.CHRONICLES_KV, id, result.chronicle)
      } catch {
        // Cache failure is non-blocking
      }

      await sendEvent("result", result.chronicle)
    } catch (err) {
      console.error("Streaming pipeline execution failed:", err)
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

  // Ensure the pipeline runs to completion
  void pipeline

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}
