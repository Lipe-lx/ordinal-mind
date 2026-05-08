import { cacheGet } from "../cache"
import type { Env } from "../index"
import { getWikiSchemaFailure, isMissingWikiSchemaError, toWikiToolUnavailable } from "./schema"
import { isInscriptionId } from "./contribute"
import { performWebSearch } from "../agents/webResearch"
import { enforceRateLimit, isTrustedWriteRequest } from "../security"

export async function handleWikiTool(toolName: string, request: Request, env: Env): Promise<Response> {
  try {
    const requestUrl = new URL(request.url)
    if (!isTrustedWriteRequest(request, requestUrl, env.ALLOWED_ORIGINS)) {
      console.warn(JSON.stringify({ at: new Date().toISOString(), event: "security.write_origin_blocked", route: "/api/wiki/tools/*" }))
      return json({ ok: false, error: "untrusted_origin" }, 403)
    }

    const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
      keyPrefix: "wiki_tools",
      limit: 45,
      windowSeconds: 60,
      alertThreshold: 30,
    })
    if (!rate.ok) {
      return json({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds }, 429)
    }

    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      payload = {}
    }

    switch (toolName) {
      case "search_wiki":
        return json(await searchWiki(payload, env))
      case "get_raw_events":
        return json(await getRawEvents(payload, env))
      case "get_timeline":
        return json(await getTimeline(payload, env))
      case "get_collection":
      case "get_collection_context":
        return json(await getCollectionContext(payload, env))
      case "web_search":
        return json(await performWebSearchTool(payload, env))
      case "deep_research":
        return json(await performWebSearchTool(payload, env, true))
      default:
        return json({ ok: false, error: "unknown_tool", tool: toolName }, 404)
    }
  } catch (err) {
    console.error("[WikiTools] request failed:", err)
    if (isMissingWikiSchemaError(err)) {
      return json(
        {
          ok: false,
          error: "wiki_schema_missing",
          status: "schema_missing",
          partial: true,
          phase: "fail_soft",
        },
        200
      )
    }

    return json(
      {
        ok: false,
        error: err instanceof Error && err.message ? err.message : "wiki_tools_failed",
        partial: true,
      },
      200
    )
  }
}

async function searchWiki(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const schemaFailure = await getWikiSchemaFailure(env)
  if (schemaFailure) return toWikiToolUnavailable(schemaFailure)
  if (!env.DB) return { ok: false, error: "wiki_db_unavailable", partial: true }

  const query = extractString(input.query)
  if (!query) {
    return { ok: false, error: "query_required" }
  }

  const limit = Math.min(Math.max(extractNumber(input.limit) ?? 5, 1), 10)
  const entityType = extractString(input.entity_type)
  const ftsQuery = sanitizeFtsQuery(query)

  if (!ftsQuery) {
    return { ok: false, error: "query_invalid" }
  }

  let rows: D1Result<WikiSearchRow>
  if (entityType) {
    rows = await env.DB.prepare(`
      SELECT wp.slug, wp.title, wp.summary, wp.entity_type, wp.unverified_count,
             bm25(wiki_fts) AS score
      FROM wiki_fts
      JOIN wiki_pages wp ON wiki_fts.slug = wp.slug
      WHERE wiki_fts MATCH ?
        AND wp.entity_type = ?
      ORDER BY score
      LIMIT ?
    `)
      .bind(ftsQuery, entityType, limit)
      .all<WikiSearchRow>()
  } else {
    rows = await env.DB.prepare(`
      SELECT wp.slug, wp.title, wp.summary, wp.entity_type, wp.unverified_count,
             bm25(wiki_fts) AS score
      FROM wiki_fts
      JOIN wiki_pages wp ON wiki_fts.slug = wp.slug
      WHERE wiki_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `)
      .bind(ftsQuery, limit)
      .all<WikiSearchRow>()
  }

  return {
    ok: true,
    query,
    results: rows.results ?? [],
  }
}

async function getRawEvents(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const schemaFailure = await getWikiSchemaFailure(env)
  if (schemaFailure) return toWikiToolUnavailable(schemaFailure)
  if (!env.DB) return { ok: false, error: "wiki_db_unavailable", partial: true }

  const inscriptionId = extractInscriptionId(input)
  if (!inscriptionId) {
    return { ok: false, error: "inscription_id_required" }
  }

  const limit = Math.min(Math.max(extractNumber(input.limit) ?? 50, 1), 200)
  const eventTypes = extractStringArray(input.event_types)

  let rows: D1Result<RawEventRow>
  if (eventTypes.length > 0) {
    const placeholders = eventTypes.map(() => "?").join(",")
    rows = await env.DB.prepare(`
      SELECT id, event_type, timestamp, block_height, source_type,
             source_ref, description, metadata_json
      FROM raw_chronicle_events
      WHERE inscription_id = ?
        AND event_type IN (${placeholders})
      ORDER BY timestamp ASC
      LIMIT ?
    `)
      .bind(inscriptionId, ...eventTypes, limit)
      .all<RawEventRow>()
  } else {
    rows = await env.DB.prepare(`
      SELECT id, event_type, timestamp, block_height, source_type,
             source_ref, description, metadata_json
      FROM raw_chronicle_events
      WHERE inscription_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `)
      .bind(inscriptionId, limit)
      .all<RawEventRow>()
  }

  const events = (rows.results ?? []).map((row) => ({
    id: row.id,
    event_type: row.event_type,
    timestamp: row.timestamp,
    block_height: row.block_height,
    source_type: row.source_type,
    source_ref: row.source_ref,
    description: row.description,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
  }))

  return {
    ok: true,
    inscription_id: inscriptionId,
    event_count: events.length,
    events,
  }
}

async function getTimeline(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const inscriptionId = extractInscriptionId(input)
  if (!inscriptionId) {
    return { ok: false, error: "inscription_id_required" }
  }

  const chronicle = await cacheGet(env.CHRONICLES_KV, inscriptionId)
  if (chronicle) {
    return {
      ok: true,
      source: "chronicle_cache",
      inscription_id: inscriptionId,
      events: chronicle.events,
      meta: chronicle.meta,
      collector_signals: chronicle.collector_signals,
    }
  }

  const fallback = await getRawEvents({ inscription_id: inscriptionId, limit: 100 }, env)
  return {
    ok: true,
    source: "layer0",
    inscription_id: inscriptionId,
    timeline: fallback,
    partial: fallback.ok === false,
  }
}

async function getCollectionContext(input: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  const collectionSlug = extractString(input.collection_slug)

  if (collectionSlug) {
    const schemaFailure = await getWikiSchemaFailure(env)
    if (schemaFailure) return toWikiToolUnavailable(schemaFailure)
    if (!env.DB) return { ok: false, error: "wiki_db_unavailable", partial: true }

    const wikiSlug = `collection:${collectionSlug}`
    const page = await env.DB.prepare(`
      SELECT slug, entity_type, title, summary, sections_json,
             cross_refs_json, source_event_ids_json, generated_at,
             byok_provider, unverified_count, view_count, updated_at
      FROM wiki_pages
      WHERE slug = ?
      LIMIT 1
    `)
      .bind(wikiSlug)
      .first<Record<string, unknown>>()

    let stats: { count: number; first_seen: string | null; last_seen: string | null } | null

    if (isInscriptionId(collectionSlug)) {
      stats = await env.DB.prepare(`
        SELECT 1 as count, timestamp as first_seen, timestamp as last_seen
        FROM raw_chronicle_events
        WHERE inscription_id = ? AND event_type = 'genesis'
        LIMIT 1
      `)
        .bind(collectionSlug)
        .first()
    } else {
      stats = await env.DB.prepare(`
        SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen
        FROM raw_chronicle_events
        WHERE event_type = 'genesis'
          AND inscription_id IN (
            SELECT inscription_id 
            FROM raw_chronicle_events 
            WHERE event_type = 'collection_link' 
              AND (
                json_extract(metadata_json, '$.name') = ?
                OR json_extract(metadata_json, '$.parent_inscription_id') = ?
              )
          )
      `)
        .bind(collectionSlug, collectionSlug)
        .first()
    }

    return {
      ok: true,
      source: "wiki_db",
      collection_slug: collectionSlug,
      collection_size: stats?.count ?? 0,
      collection_size_source: "raw_chronicle_events.genesis",
      collection_first_seen: stats?.first_seen ?? null,
      collection_last_seen: stats?.last_seen ?? null,
      page: page ? toWikiPageResponse(page) : null,
      stats: stats ?? { count: 0, first_seen: null, last_seen: null },
    }
  }

  const inscriptionId = extractInscriptionId(input)
  if (!inscriptionId) {
    return { ok: false, error: "inscription_id_required_or_collection_slug_required" }
  }

  const chronicle = await cacheGet(env.CHRONICLES_KV, inscriptionId)
  if (!chronicle) {
    return {
      ok: false,
      error: "chronicle_not_cached",
      inscription_id: inscriptionId,
      partial: true,
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

async function performWebSearchTool(input: Record<string, unknown>, env: Env, deep = false): Promise<Record<string, unknown>> {
  const query = extractString(input.query)
  if (!query) return { ok: false, error: "query_required" }

  const result = await performWebSearch(query, {
    deepResearch: deep,
    maxResults: deep ? 8 : 5,
    sourceLabel: deep ? "deep_research_tool" : "web_search_tool"
  })

  if (!result) return { ok: false, error: "no_results_found" }

  return {
    ok: true,
    ...result
  }
}

function sanitizeFtsQuery(query: string): string {
  const cleaned = query
    .replace(/['"*^():]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return ""

  const tokens = cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.map((token) => `${token}*`).join(" ")
}

function extractInscriptionId(input: Record<string, unknown>): string {
  const value = input.inscription_id ?? input.inscriptionId ?? input.id
  return extractString(value)
}

function extractString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim()
}

function extractNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toWikiPageResponse(row: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: row.slug,
    entity_type: row.entity_type,
    title: row.title,
    summary: row.summary,
    sections: safeJsonParse(row.sections_json as string, []),
    cross_refs: safeJsonParse(row.cross_refs_json as string, []),
    source_event_ids: safeJsonParse(row.source_event_ids_json as string, []),
    generated_at: row.generated_at,
    byok_provider: row.byok_provider,
    unverified_count: row.unverified_count,
    view_count: row.view_count,
    updated_at: row.updated_at,
  }
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

interface D1Result<T> {
  results?: T[]
}

interface WikiSearchRow {
  slug: string
  title: string
  summary: string
  entity_type: string
  unverified_count: number
  score: number
}

interface RawEventRow {
  id: string
  event_type: string
  timestamp: string
  block_height: number
  source_type: string
  source_ref: string
  description: string
  metadata_json: string
}
