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
import { isInscriptionId } from "../wiki/contribute"

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

function timestampToMs(value: string | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
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

  if (caps.canContributeWiki) {
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
