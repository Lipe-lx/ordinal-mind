import { cacheGet } from "../cache"
import type { Env } from "../index"

export async function handleWikiTool(toolName: string, request: Request, env: Env): Promise<Response> {
  let payload: Record<string, unknown> = {}
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    // keep empty payload
  }

  switch (toolName) {
    case "get_timeline":
      return json(await getTimeline(payload, env))
    case "get_collection_context":
      return json(await getCollectionContext(payload, env))
    default:
      return json({ ok: false, error: "unknown_tool", tool: toolName }, 404)
  }
}

async function getTimeline(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const inscriptionId = extractInscriptionId(input)
  if (!inscriptionId) {
    return { ok: false, error: "inscription_id_required" }
  }

  const chronicle = await cacheGet(env.CHRONICLES_KV, inscriptionId)
  if (!chronicle) {
    return {
      ok: false,
      error: "chronicle_not_cached",
      inscription_id: inscriptionId,
    }
  }

  return {
    ok: true,
    source: "chronicle_cache",
    inscription_id: inscriptionId,
    events: chronicle.events,
    meta: chronicle.meta,
    collector_signals: chronicle.collector_signals,
  }
}

async function getCollectionContext(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const inscriptionId = extractInscriptionId(input)
  if (!inscriptionId) {
    return { ok: false, error: "inscription_id_required" }
  }

  const chronicle = await cacheGet(env.CHRONICLES_KV, inscriptionId)
  if (!chronicle) {
    return {
      ok: false,
      error: "chronicle_not_cached",
      inscription_id: inscriptionId,
    }
  }

  return {
    ok: true,
    source: "chronicle_cache",
    inscription_id: inscriptionId,
    collection_context: chronicle.collection_context,
    source_catalog: chronicle.source_catalog,
  }
}

function extractInscriptionId(input: Record<string, unknown>): string {
  const value = input.inscription_id ?? input.inscriptionId ?? input.id
  if (typeof value !== "string") return ""
  return value.trim()
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
