import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index"
import type { DiagnosticsContext, ProgressCallback } from "../pipeline/types"
import type { OGTier } from "../auth/jwt"
import type { ChronicleEvent, EventType } from "../../app/lib/types"
import { cacheGet } from "../cache"
import { resolveInput } from "../resolver"
import { signJWT } from "../auth/jwt"
import { enforceRateLimit } from "../security"
import { handleContribute } from "../wiki/contribute"
import { handleReviewDecision } from "../wiki/reviews"
import { runChroniclePipeline, newRequestId } from "../chronicleService"
import { toCapabilityMap, type McpResolvedAuth } from "./types"
import { MCP_LIMITS, limitWikiContributionValue } from "./guards"
import { CANONICAL_FIELDS, isCanonicalField, isFieldAllowedForSlug, isInscriptionId } from "../wiki/contribute"
import { getConsolidatedSnapshot } from "../wiki/consolidateEndpoint"

const contributeSchema = {
  collection_slug: z.string().min(1),
  field: z.string().min(1),
  value: z.string().min(1),
  confidence: z.enum(["stated_by_user", "inferred", "correcting_existing"]).default("stated_by_user"),
  verifiable: z.boolean().default(true),
  source_excerpt: z.string().optional(),
  operation: z.enum(["add", "delete"]).default("add"),
}

const reviewSchema = {
  review_id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
}

const refreshSchema = {
  inscription_id: z.string().min(1),
  lite: z.boolean().default(false),
  debug: z.boolean().default(false),
}

const reindexSchema = {
  collection_slug: z.string().min(1),
  max_items: z.number().int().min(1).max(MCP_LIMITS.MAX_REINDEX_ITEMS).default(10),
}

const QUERY_EVENT_TYPES = [
  "genesis",
  "transfer",
  "sale",
  "social_mention",
  "collection_link",
  "recursive_ref",
  "sat_context",
  "trait_context",
] as const

const queryChronicleSchema = {
  inscription_id: z.string().min(1),
  event_types: z.array(z.enum(QUERY_EVENT_TYPES)).max(8).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  sort: z.enum(["asc", "desc"]).default("asc"),
  limit: z.number().int().min(1).max(200).default(50),
  include_meta: z.boolean().default(true),
}

const searchCollectionSchema = {
  collection_slug: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(500).default(0),
  sort: z.enum(["recent", "oldest"]).default("recent"),
  include_meta: z.boolean().default(false),
}

const wikiSearchCollectionsSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(500).default(0),
}

const wikiFieldStatusSchema = {
  collection_slug: z.string().min(1),
}

const wikiCollectionContextSchema = {
  collection_slug: z.string().min(1),
  include_graph_summary: z.boolean().default(true),
}

const wikiStatsSchema = {}

const wikiProposeUpdateSchema = {
  collection_slug: z.string().min(1),
  field: z.enum(CANONICAL_FIELDS),
  proposed_value: z.string().min(1).max(MCP_LIMITS.MAX_WIKI_CONTRIBUTION_LEN),
  sources: z.array(z.string().min(1)).max(8).default([]),
  rationale: z.string().max(500).optional(),
  confidence: z.enum(["stated_by_user", "inferred", "correcting_existing"]).default("stated_by_user"),
  verifiable: z.boolean().default(true),
  idempotency_key: z.string().min(8).max(128).optional(),
}

const helpSchema = {}

type ProgressEmitter = {
  _meta?: { progressToken?: string | number } & Record<string, unknown>
  sendNotification: (...args: unknown[]) => Promise<void>
}

function jsonToolResult<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { ok: false, error: "invalid_response_payload" }
}

function unauthorizedResult(message = "authentication_required") {
  return jsonToolResult({ ok: false, error: message })
}

async function mintInternalSessionJwt(auth: McpResolvedAuth, env: Env): Promise<string | null> {
  if (!env.JWT_SECRET) return null
  const payload = {
    sub: auth.props.sub,
    username: auth.props.username,
    avatar: auth.props.avatar,
    tier: auth.props.tier,
    badges: [],
  }
  return signJWT(payload, env.JWT_SECRET)
}

async function sendProgress(
  extra: ProgressEmitter,
  progress: number,
  total: number,
  message: string
): Promise<void> {
  const progressToken = extra?._meta?.progressToken
  if (progressToken === undefined || progressToken === null) return

  await extra.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken,
      progress,
      total,
      message,
    },
  })
}

function normalizeTierForTool(tier: OGTier | undefined): OGTier {
  if (tier === "community" || tier === "og" || tier === "genesis") return tier
  return "anon"
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeEventType(value: string): EventType {
  if (value === "x_mention") return "social_mention"
  if (QUERY_EVENT_TYPES.includes(value as EventType)) return value as EventType
  return "transfer"
}

function sanitizeFtsQuery(query: string): string {
  const cleaned = query
    .replace(/['"*^():]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) return ""
  return cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(" ")
}

function normalizeCollectionSlug(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith("collection:") ? trimmed.slice("collection:".length) : trimmed
}

function isLikelySourceRef(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (isInscriptionId(trimmed)) return true
  try {
    const url = new URL(trimmed)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function toSourceExcerpt(input: {
  sources: string[]
  rationale?: string
  idempotency_key?: string
}): string {
  const lines: string[] = []
  if (input.idempotency_key) lines.push(`idempotency_key: ${input.idempotency_key}`)
  if (input.rationale) lines.push(`rationale: ${input.rationale}`)
  if (input.sources.length > 0) {
    lines.push("sources:")
    for (const source of input.sources) lines.push(`- ${source}`)
  }
  return lines.join("\n").slice(0, 500)
}

function timestampToMs(value: string | undefined): number | null {
  if (!value) return null
  let ms = new Date(value).getTime()
  if (Number.isFinite(ms)) return ms
  ms = new Date(value.replace(" ", "T") + "Z").getTime()
  return Number.isFinite(ms) ? ms : null
}

async function hasWikiContributionUpdatedAtColumn(env: Env): Promise<boolean> {
  if (!env.DB) return false
  try {
    const tableInfo = await env.DB.prepare("PRAGMA table_info('wiki_contributions')")
      .all<{ name: string }>()
    const names = new Set((tableInfo.results ?? []).map((row) => row.name))
    return names.has("updated_at")
  } catch {
    return false
  }
}

async function readWikiStatsUpdatedAt(env: Env): Promise<string | null> {
  if (!env.DB) return null

  const pageRow = await env.DB.prepare(`
    SELECT MAX(updated_at) AS updated_at
    FROM wiki_pages
  `)
    .all<{ updated_at: string | null }>()

  const contributionTimeField = await hasWikiContributionUpdatedAtColumn(env) ? "updated_at" : "created_at"
  const contributionRow = await env.DB.prepare(`
    SELECT MAX(${contributionTimeField}) AS updated_at
    FROM wiki_contributions
    WHERE status IN ('published', 'quarantine')
  `)
    .all<{ updated_at: string | null }>()

  const pageUpdatedAt = pageRow.results?.[0]?.updated_at ?? null
  const contributionUpdatedAt = contributionRow.results?.[0]?.updated_at ?? null
  const candidates = [pageUpdatedAt, contributionUpdatedAt]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)

  let latest: number | null = null
  for (const value of candidates) {
    const ts = timestampToMs(value)
    if (ts === null) continue
    latest = latest === null ? ts : Math.max(latest, ts)
  }

  if (latest === null) return null
  return new Date(latest).toISOString()
}

function filterChronicleEvents(
  events: ChronicleEvent[],
  filters: {
    event_types?: readonly EventType[]
    since?: string
    until?: string
  }
): ChronicleEvent[] {
  const allowed = filters.event_types ? new Set<EventType>(filters.event_types) : null
  const sinceMs = timestampToMs(filters.since)
  const untilMs = timestampToMs(filters.until)

  return events.filter((event) => {
    if (allowed && !allowed.has(event.event_type)) return false
    const ts = timestampToMs(event.timestamp)
    if (ts === null) return false
    if (sinceMs !== null && ts < sinceMs) return false
    if (untilMs !== null && ts > untilMs) return false
    return true
  })
}

async function readChronicleEventsForQuery(
  rawInscription: string,
  env: Env
): Promise<{
  ok: boolean
  inscription_id?: string
  source?: "chronicle_cache" | "raw_chronicle_events"
  partial?: boolean
  meta?: Record<string, unknown>
  events?: ChronicleEvent[]
  error?: string
}> {
  const resolved = await resolveInput(rawInscription)
  if (resolved.type !== "inscription") {
    return { ok: false, error: "inscription_id_required" }
  }

  const inscriptionId = resolved.value
  const cached = await cacheGet(env.CHRONICLES_KV, inscriptionId)
  if (cached) {
    return {
      ok: true,
      inscription_id: inscriptionId,
      source: "chronicle_cache",
      partial: false,
      meta: cached.meta as unknown as Record<string, unknown>,
      events: cached.events,
    }
  }

  if (!env.DB) {
    return {
      ok: false,
      error: "chronicle_not_cached_and_db_unavailable",
    }
  }

  const rows = await env.DB.prepare(`
    SELECT id, event_type, timestamp, block_height, source_type, source_ref, description, metadata_json
    FROM raw_chronicle_events
    WHERE inscription_id = ?
    ORDER BY timestamp ASC
    LIMIT 800
  `)
    .bind(inscriptionId)
    .all<{
      id: string
      event_type: string
      timestamp: string
      block_height: number
      source_type: string
      source_ref: string
      description: string
      metadata_json: string
    }>()

  const events: ChronicleEvent[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    block_height: row.block_height,
    event_type: normalizeEventType(row.event_type),
    source: {
      type: row.source_type === "onchain" ? "onchain" : "web",
      ref: row.source_ref,
    },
    description: row.description,
    metadata: safeParse(row.metadata_json, {} as Record<string, unknown>),
  }))

  return {
    ok: true,
    inscription_id: inscriptionId,
    source: "raw_chronicle_events",
    partial: true,
    events,
  }
}

async function runRefresh(
  inscriptionId: string,
  env: Env,
  options: { lite: boolean; debug: boolean },
  onProgress?: ProgressCallback
) {
  const diagnostics: DiagnosticsContext = {
    debug: options.debug,
    requestId: newRequestId(),
    route: "stream",
    inscriptionId,
  }

  const result = await runChroniclePipeline({
    id: inscriptionId,
    env,
    diagnostics,
    lite: options.lite,
    onProgress,
    persistToDb: true,
    writeCache: true,
    writeValidation: true,
  })

  return result
}

export function registerTools(options: {
  server: McpServer
  env: Env
  auth?: McpResolvedAuth
  request: Request
}): void {
  const { server, env, auth, request } = options
  const tier = normalizeTierForTool(auth?.props.tier)
  const caps = toCapabilityMap(tier)

  server.registerTool(
    "help",
    {
      description: "Usage guide for this MCP server: recommended workflow, tool selection, and tier behavior",
      inputSchema: helpSchema,
    },
    async () => {
      const writableTools: string[] = []
      if (caps.canContributeWiki) writableTools.push("wiki_propose_update", "contribute_wiki")
      if (caps.canReviewContribution) writableTools.push("review_contribution")
      if (caps.canRefreshChronicle) writableTools.push("refresh_chronicle", "reindex_collection")

      return jsonToolResult({
        ok: true,
        server: "ordinal-mind",
        tier,
        strategy: {
          intent: "Factual-first research for Bitcoin Ordinals with optional wiki governance actions.",
          steps: [
            "If the slug is unknown, discover candidates with wiki_search_collections. Note: items are searchable as soon as they have technical data (completeness > 0).",
            "Confirm context with wiki_get_collection_context (or wiki://collection/{slug}).",
            "From a known slug, get inscription IDs with search_collection_inscriptions.",
            "Audit each known inscription ID with query_chronicle (or chronicle://inscription/{id}).",
          ],
        },
        when_to_use: {
          resources: [
            "Use resources/read for canonical snapshots by known identifier (stable and cache-friendly).",
          ],
          tools: [
            "Use tools/call for filtered queries, discovery, and governance actions.",
          ],
          distinction: {
            wiki: "Consensus/context layer (narrative, coverage, community curation).",
            chronicle: "Technical audit layer (timestamped on-chain and derived factual events).",
          },
        },
        governance: {
          wiki_propose_update: "Follows app tier rules: community -> quarantine, og/genesis -> published.",
          review_contribution: "Genesis-only moderation action.",
        },
        available_tools_now: {
          read_only: [
            "help",
            "query_chronicle",
            "search_collection_inscriptions",
            "wiki_search_collections",
            "wiki_stats",
            "wiki_get_field_status",
            "wiki_get_collection_context",
          ],
          writable: writableTools,
        },
        examples: [
          "Discover slug: wiki_search_collections { query: '<collection-name-or-keyword>', limit: 10, offset: 0 }. Check 'completeness' score; items with 'is_seed: true' have data but pending narrative.",
          "Load context: wiki_get_collection_context { collection_slug: '<slug-from-search>', include_graph_summary: true }.",
          "List related inscriptions: search_collection_inscriptions { collection_slug: '<slug-from-search>', limit: 20, offset: 0, sort: 'recent' }.",
          "Audit one inscription: query_chronicle { inscription_id: '<inscription-id>', event_types: ['genesis','transfer'], sort: 'asc', limit: 25 }.",
        ],
      })
    }
  )

  server.registerTool(
    "query_chronicle",
    {
      description: "Read-only chronicle query by inscription with filters and deterministic limits",
      inputSchema: queryChronicleSchema,
    },
    async (args) => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_query_chronicle",
        limit: 60,
        windowSeconds: 60,
        alertThreshold: 40,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      const loaded = await readChronicleEventsForQuery(String(args.inscription_id), env)
      if (!loaded.ok || !loaded.inscription_id || !loaded.events || !loaded.source) {
        return jsonToolResult({
          ok: false,
          error: loaded.error ?? "chronicle_query_failed",
          inscription_id: String(args.inscription_id),
        })
      }

      const eventTypes = Array.isArray(args.event_types)
        ? (args.event_types.map((value) => normalizeEventType(String(value))) as EventType[])
        : undefined
      const filtered = filterChronicleEvents(loaded.events, {
        event_types: eventTypes,
        since: typeof args.since === "string" ? args.since : undefined,
        until: typeof args.until === "string" ? args.until : undefined,
      })

      const sorted = args.sort === "desc" ? [...filtered].reverse() : filtered
      const limited = sorted.slice(0, Number(args.limit))

      return jsonToolResult({
        ok: true,
        source: loaded.source,
        inscription_id: loaded.inscription_id,
        filters: {
          event_types: eventTypes ?? [],
          since: args.since ?? null,
          until: args.until ?? null,
          sort: args.sort,
          limit: args.limit,
        },
        total_matched: filtered.length,
        returned_count: limited.length,
        partial: loaded.partial ?? false,
        meta: args.include_meta ? (loaded.meta ?? null) : undefined,
        events: limited,
        resource_uris: [`chronicle://inscription/${loaded.inscription_id}`],
      })
    }
  )

  server.registerTool(
    "search_collection_inscriptions",
    {
      description: "Read-only collection query with pagination and optional cache metadata enrichment",
      inputSchema: searchCollectionSchema,
    },
    async (args) => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_search_collection",
        limit: 50,
        windowSeconds: 60,
        alertThreshold: 35,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      const slug = String(args.collection_slug)
      const limit = Number(args.limit)
      const offset = Number(args.offset)
      const direction = args.sort === "oldest" ? "ASC" : "DESC"

      if (isInscriptionId(slug)) {
        const cached = await cacheGet(env.CHRONICLES_KV, slug)
        return jsonToolResult({
          ok: true,
          collection_slug: slug,
          total: 1,
          limit,
          offset,
          sort: args.sort,
          items: [{
            inscription_id: slug,
            last_seen: cached?.cached_at ?? null,
            event_count: null,
            meta: args.include_meta
              ? (cached ? {
                inscription_number: cached.meta.inscription_number,
                content_type: cached.meta.content_type,
                owner_address: cached.meta.owner_address,
              } : null)
              : undefined,
          }],
          resource_uris: [
            `collection://context/${slug}`,
            `chronicle://inscription/${slug}`,
          ],
          partial: !cached,
        })
      }

      if (!env.DB) {
        return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })
      }

      const sql = `
        SELECT inscription_id, MAX(timestamp) AS last_seen, COUNT(*) AS event_count
        FROM raw_chronicle_events
        WHERE event_type = 'collection_link'
          AND (
            json_extract(metadata_json, '$.name') = ?
            OR json_extract(metadata_json, '$.parent_inscription_id') = ?
          )
        GROUP BY inscription_id
        ORDER BY last_seen ${direction}
        LIMIT ?
        OFFSET ?
      `

      const rows = await env.DB.prepare(sql)
        .bind(slug, slug, limit, offset)
        .all<{ inscription_id: string; last_seen: string | null; event_count: number }>()

      const countRows = await env.DB.prepare(`
        SELECT COUNT(DISTINCT inscription_id) AS total
        FROM raw_chronicle_events
        WHERE event_type = 'collection_link'
          AND (
            json_extract(metadata_json, '$.name') = ?
            OR json_extract(metadata_json, '$.parent_inscription_id') = ?
          )
      `)
        .bind(slug, slug)
        .all<{ total: number }>()

      const baseItems = (rows.results ?? []).map((row) => ({
        inscription_id: row.inscription_id,
        last_seen: row.last_seen,
        event_count: row.event_count,
      }))

      const items = args.include_meta
        ? await Promise.all(baseItems.map(async (item) => {
          const cached = await cacheGet(env.CHRONICLES_KV, item.inscription_id)
          return {
            ...item,
            meta: cached ? {
              inscription_number: cached.meta.inscription_number,
              content_type: cached.meta.content_type,
              owner_address: cached.meta.owner_address,
            } : null,
          }
        }))
        : baseItems

      return jsonToolResult({
        ok: true,
        collection_slug: slug,
        total: Number((countRows.results?.[0]?.total ?? 0)),
        limit,
        offset,
        sort: args.sort,
        items,
        resource_uris: [
          `collection://context/${slug}`,
          `wiki://collection/${slug}`,
          ...baseItems.map((item) => `chronicle://inscription/${item.inscription_id}`),
        ],
        partial: false,
      })
    }
  )

  server.registerTool(
    "wiki_search_collections",
    {
      description: "Read-only wiki collection search by text query with pagination",
      inputSchema: wikiSearchCollectionsSchema,
    },
    async (args) => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_wiki_search_collections",
        limit: 60,
        windowSeconds: 60,
        alertThreshold: 40,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      if (!env.DB) {
        return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })
      }

      const query = String(args.query).trim()
      const ftsQuery = sanitizeFtsQuery(query)
      if (!ftsQuery) return jsonToolResult({ ok: false, error: "query_invalid" })

      const limit = Number(args.limit)
      const offset = Number(args.offset)

      const rows = await env.DB.prepare(`
        SELECT 
          wp.slug, wp.title, wp.summary, wp.entity_type, wp.updated_at, 
          bm25(wiki_fts) AS score,
          cc.completeness
        FROM wiki_fts
        JOIN wiki_pages wp ON wiki_fts.slug = wp.slug
        LEFT JOIN consolidated_cache cc ON wp.slug = cc.collection_slug
        WHERE wiki_fts MATCH ?
          AND wp.entity_type = 'collection'
        ORDER BY score
        LIMIT ?
        OFFSET ?
      `)
        .bind(ftsQuery, limit, offset)
        .all<{
          slug: string
          title: string | null
          summary: string | null
          entity_type: string
          updated_at: string | null
          score: number | null
          completeness: number | null
        }>()

      const totalRows = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM wiki_fts
        JOIN wiki_pages wp ON wiki_fts.slug = wp.slug
        WHERE wiki_fts MATCH ?
          AND wp.entity_type = 'collection'
      `)
        .bind(ftsQuery)
        .all<{ total: number }>()

      const items = (rows.results ?? []).map((row) => {
        const normalizedSlug = normalizeCollectionSlug(row.slug)
        const score = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 25
        const confidence = Number((1 / (1 + Math.max(0, score))).toFixed(4))
        return {
          slug: normalizedSlug,
          title: row.title ?? normalizedSlug,
          summary: row.summary || "Discovery Draft: Narrative pending consensus growth.",
          confidence,
          completeness: row.completeness ?? 0,
          is_seed: row.updated_at === null || row.summary === "",
          updated_at: row.updated_at,
        }
      })

      return jsonToolResult({
        ok: true,
        query,
        limit,
        offset,
        total: Number(totalRows.results?.[0]?.total ?? 0),
        items,
        resource_uris: items.map((item) => `wiki://collection/${item.slug}`),
      })
    }
  )

  server.registerTool(
    "wiki_stats",
    {
      description: "Read-only global wiki coverage counters for pages, index visibility, and moderation states",
      inputSchema: wikiStatsSchema,
    },
    async () => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_wiki_stats",
        limit: 60,
        windowSeconds: 60,
        alertThreshold: 40,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      if (!env.DB) {
        return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })
      }

      const totalPagesRows = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM wiki_pages
      `)
        .all<{ total: number }>()

      const indexedPagesRows = await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM wiki_fts
      `)
        .all<{ total: number }>()

      const publishedPagesRows = await env.DB.prepare(`
        SELECT COUNT(DISTINCT collection_slug) AS total
        FROM wiki_contributions
        WHERE status = 'published'
      `)
        .all<{ total: number }>()

      const quarantinePagesRows = await env.DB.prepare(`
        SELECT COUNT(DISTINCT collection_slug) AS total
        FROM wiki_contributions
        WHERE status = 'quarantine'
      `)
        .all<{ total: number }>()

      const updatedAt = await readWikiStatsUpdatedAt(env)

      return jsonToolResult({
        ok: true,
        total_pages: Number(totalPagesRows.results?.[0]?.total ?? 0),
        indexed_pages: Number(indexedPagesRows.results?.[0]?.total ?? 0),
        published_pages: Number(publishedPagesRows.results?.[0]?.total ?? 0),
        quarantine_pages: Number(quarantinePagesRows.results?.[0]?.total ?? 0),
        updated_at: updatedAt,
      })
    }
  )

  server.registerTool(
    "wiki_get_field_status",
    {
      description: "Read-only wiki field coverage and status for a collection slug",
      inputSchema: wikiFieldStatusSchema,
    },
    async (args) => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_wiki_field_status",
        limit: 60,
        windowSeconds: 60,
        alertThreshold: 40,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      if (!env.DB) return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })

      const slug = normalizeCollectionSlug(String(args.collection_slug))
      const snapshot = await getConsolidatedSnapshot(slug, env)
      const fields = Object.entries(snapshot.data.narrative).map(([name, value]) => {
        const weighted = value.contributions[0]?.weight
        return {
          name,
          status: value.status,
          confidence: typeof weighted === "number" ? weighted : snapshot.data.confidence,
          resolved_by_tier: value.resolved_by_tier,
          last_updated: value.contributions[0]?.created_at ?? null,
          contribution_count: value.contributions.length,
        }
      })

      return jsonToolResult({
        ok: true,
        collection_slug: slug,
        completeness_score: snapshot.data.completeness.score,
        completeness: snapshot.data.completeness,
        confidence: snapshot.data.confidence,
        fields,
        gaps: snapshot.data.gaps,
        cached: snapshot.cached,
        resource_uris: [
          `wiki://collection/${slug}`,
          `collection://context/${slug}`,
        ],
      })
    }
  )

  server.registerTool(
    "wiki_get_collection_context",
    {
      description: "Read-only collection context snapshot (consensus + optional graph summary)",
      inputSchema: wikiCollectionContextSchema,
    },
    async (args) => {
      const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
        keyPrefix: "mcp_wiki_collection_context",
        limit: 60,
        windowSeconds: 60,
        alertThreshold: 40,
      })
      if (!rate.ok) {
        return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
      }

      if (!env.DB) return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })

      const slug = normalizeCollectionSlug(String(args.collection_slug))
      const snapshot = await getConsolidatedSnapshot(slug, env)
      let graph_summary: Record<string, unknown> | null = null

      if (args.include_graph_summary) {
        const graphRows = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM wiki_pages
          WHERE slug = ? OR slug LIKE ?
        `)
          .bind(`collection:${slug}`, `${slug}:%`)
          .all<{ total: number }>()

        graph_summary = {
          related_wiki_pages: Number(graphRows.results?.[0]?.total ?? 0),
        }
      }

      return jsonToolResult({
        ok: true,
        collection_slug: slug,
        consolidated: snapshot.data,
        graph_summary,
        cached: snapshot.cached,
        resource_uris: [
          `collection://context/${slug}`,
          `wiki://collection/${slug}`,
        ],
      })
    }
  )

  if (caps.canContributeWiki) {
    server.registerTool(
      "wiki_propose_update",
      {
        description: "Create a wiki proposal following standard tier governance rules",
        inputSchema: wikiProposeUpdateSchema,
      },
      async (args) => {
        if (!auth) return unauthorizedResult()
        if (!env.DB) return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })

        const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
          keyPrefix: "mcp_wiki_propose_update",
          limit: 24,
          windowSeconds: 60,
          alertThreshold: 16,
        })
        if (!rate.ok) {
          return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
        }

        const slug = normalizeCollectionSlug(String(args.collection_slug))
        const field = String(args.field)
        if (!isCanonicalField(field)) {
          return jsonToolResult({ ok: false, error: "invalid_canonical_field", field })
        }
        if (!isFieldAllowedForSlug(field, slug)) {
          return jsonToolResult({
            ok: false,
            error: "field_scope_mismatch",
            detail: `Field '${field}' is not allowed for ${isInscriptionId(slug) ? "inscriptions" : "collections"}.`,
          })
        }

        const sources = Array.isArray(args.sources)
          ? args.sources.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
          : []
        const invalidSources = sources.filter((value) => !isLikelySourceRef(value))
        if (invalidSources.length > 0) {
          return jsonToolResult({
            ok: false,
            error: "invalid_sources",
            invalid_sources: invalidSources,
          })
        }

        const rationale = typeof args.rationale === "string" ? args.rationale.trim() : undefined
        const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key.trim() : undefined
        const sourceExcerpt = toSourceExcerpt({
          sources,
          rationale,
          idempotency_key: idempotencyKey,
        })

        const jwt = await mintInternalSessionJwt(auth, env)
        if (!jwt) return jsonToolResult({ ok: false, error: "auth_not_configured" })

        const internalRequest = new Request("https://ordinalmind.local/api/wiki/contribute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            contribution: {
              collection_slug: slug,
              field,
              value: limitWikiContributionValue(String(args.proposed_value)),
              confidence: args.confidence,
              verifiable: Boolean(args.verifiable),
              session_id: `mcp-proposal-${auth.props.sub}`,
              source_excerpt: sourceExcerpt || undefined,
              operation: "add",
            },
          }),
        })

        const response = await handleContribute(internalRequest, env)
        const payload = asRecord(await response.json().catch(() => ({ ok: false, error: "invalid_response" })))

        const proposalId = typeof payload.contribution_id === "string" ? payload.contribution_id : null
        const status = typeof payload.status === "string" ? payload.status : "unknown"

        return jsonToolResult({
          ok: Boolean(payload.ok),
          proposal_id: proposalId,
          status,
          tier_applied: payload.tier_applied ?? auth.props.tier,
          idempotency_key: idempotencyKey ?? null,
          validation: {
            passed: true,
            issues: [] as string[],
          },
          normalized_value: limitWikiContributionValue(String(args.proposed_value)).trim(),
          sources,
          rationale: rationale ?? null,
          resource_uris: [
            `wiki://collection/${slug}`,
            `collection://context/${slug}`,
          ],
          upstream: payload,
        })
      }
    )

    server.registerTool(
      "contribute_wiki",
      {
        description: "Submit a structured wiki contribution for collection or inscription consensus",
        inputSchema: contributeSchema,
      },
      async (args) => {
        if (!auth) return unauthorizedResult()
        const jwt = await mintInternalSessionJwt(auth, env)
        if (!jwt) return jsonToolResult({ ok: false, error: "auth_not_configured" })

        const body = {
          contribution: {
            collection_slug: String(args.collection_slug),
            field: String(args.field),
            value: limitWikiContributionValue(String(args.value)),
            confidence: args.confidence,
            verifiable: Boolean(args.verifiable),
            session_id: `mcp-${auth.props.sub}`,
            source_excerpt: typeof args.source_excerpt === "string" ? args.source_excerpt.slice(0, 500) : undefined,
            operation: args.operation,
          },
        }

        const internalRequest = new Request("https://ordinalmind.local/api/wiki/contribute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify(body),
        })

        const response = await handleContribute(internalRequest, env)
        const payload = await response.json().catch(() => ({ ok: false, error: "invalid_response" }))
        return jsonToolResult(asRecord(payload))
      }
    )
  }

  if (caps.canReviewContribution) {
    server.registerTool(
      "review_contribution",
      {
        description: "Approve or reject a quarantined wiki contribution (Genesis only)",
        inputSchema: reviewSchema,
      },
      async (args) => {
        if (!auth) return unauthorizedResult()

        const jwt = await mintInternalSessionJwt(auth, env)
        if (!jwt) return jsonToolResult({ ok: false, error: "auth_not_configured" })

        const internalRequest = new Request(
          `https://ordinalmind.local/api/wiki/reviews/${encodeURIComponent(String(args.review_id))}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({ action: args.action }),
          }
        )

        const response = await handleReviewDecision(internalRequest, env, String(args.review_id))
        const payload = await response.json().catch(() => ({ ok: false, error: "invalid_response" }))
        return jsonToolResult(asRecord(payload))
      }
    )
  }

  if (caps.canRefreshChronicle) {
    server.registerTool(
      "refresh_chronicle",
      {
        description: "Force a factual chronicle recomputation and cache refresh for an inscription",
        inputSchema: refreshSchema,
      },
      async (args, extra) => {
        if (!auth) return unauthorizedResult()

        const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
          keyPrefix: "mcp_refresh_chronicle",
          limit: 18,
          windowSeconds: 60,
          alertThreshold: 10,
        })
        if (!rate.ok) {
          return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
        }

        const progress = extra as unknown as ProgressEmitter
        await sendProgress(progress, 0, 6, "Starting forced chronicle refresh")

        const onProgress: ProgressCallback = async (phase, step, description) => {
          const normalized = normalizePhaseProgress(phase, step)
          await sendProgress(progress, normalized.progress, normalized.total, description)
        }

        const result = await runRefresh(String(args.inscription_id), env, {
          lite: Boolean(args.lite),
          debug: Boolean(args.debug),
        }, onProgress)

        await sendProgress(progress, 6, 6, "Chronicle refresh complete")

        return jsonToolResult({
          ok: true,
          inscription_id: args.inscription_id,
          request_id: result.trace.request_id,
          phases: result.trace.phases,
          total_duration_ms: result.trace.total_duration_ms,
          event_count: result.events.length,
          chronicle: result.chronicle,
          partial: false,
        })
      }
    )

    server.registerTool(
      "reindex_collection",
      {
        description: "Recompute and cache multiple inscriptions associated with a collection slug (Genesis only)",
        inputSchema: reindexSchema,
      },
      async (args, extra) => {
        if (!auth) return unauthorizedResult()

        const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
          keyPrefix: "mcp_reindex_collection",
          limit: 6,
          windowSeconds: 60,
          alertThreshold: 4,
        })
        if (!rate.ok) {
          return jsonToolResult({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds })
        }

        if (!env.DB) {
          return jsonToolResult({ ok: false, error: "wiki_db_unavailable" })
        }

        const slug = String(args.collection_slug)
        const maxItems = Math.min(Number(args.max_items ?? 10), MCP_LIMITS.MAX_REINDEX_ITEMS)

        let inscriptionIds: string[]
        if (isInscriptionId(slug)) {
          inscriptionIds = [slug]
        } else {
          const rows = await env.DB.prepare(`
            SELECT inscription_id, MAX(timestamp) AS last_seen
            FROM raw_chronicle_events
            WHERE event_type = 'collection_link'
              AND (
                json_extract(metadata_json, '$.name') = ?
                OR json_extract(metadata_json, '$.parent_inscription_id') = ?
              )
            GROUP BY inscription_id
            ORDER BY last_seen DESC
            LIMIT ?
          `)
            .bind(slug, slug, maxItems)
            .all<{ inscription_id: string }>()

          inscriptionIds = (rows.results ?? []).map((row) => row.inscription_id)
        }

        if (inscriptionIds.length === 0) {
          return jsonToolResult({ ok: false, error: "collection_has_no_known_inscriptions", collection_slug: slug })
        }

        const refreshed: Array<{ inscription_id: string; ok: boolean; error?: string }> = []
        const total = inscriptionIds.length
        const progress = extra as unknown as ProgressEmitter

        for (let i = 0; i < inscriptionIds.length; i++) {
          const inscriptionId = inscriptionIds[i]
          await sendProgress(progress, i, total, `Refreshing ${inscriptionId} (${i + 1}/${total})`)
          try {
            await runRefresh(inscriptionId, env, { lite: false, debug: false })
            refreshed.push({ inscription_id: inscriptionId, ok: true })
          } catch (error) {
            refreshed.push({
              inscription_id: inscriptionId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        await sendProgress(progress, total, total, "Collection reindex complete")

        return jsonToolResult({
          ok: true,
          collection_slug: slug,
          total,
          refreshed,
          refreshed_ok: refreshed.filter((item) => item.ok).length,
          refreshed_failed: refreshed.filter((item) => !item.ok).length,
          partial: refreshed.some((item) => !item.ok),
        })
      }
    )
  }
}

function normalizePhaseProgress(phase: string, step: number): { progress: number; total: number } {
  const phaseBase: Record<string, number> = {
    metadata: 1,
    transfers: 2,
    mentions: 3,
    unisat: 4,
    complete: 5,
  }
  const base = phaseBase[phase] ?? 1
  const clampedStep = Number.isFinite(step) ? Math.max(0, Math.min(step, 3)) : 0
  return {
    progress: Math.min(5, Math.max(1, base + (clampedStep * 0.1))),
    total: 6,
  }
}
