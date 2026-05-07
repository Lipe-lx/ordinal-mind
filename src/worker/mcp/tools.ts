import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index"
import type { DiagnosticsContext, ProgressCallback } from "../pipeline/types"
import type { OGTier } from "../auth/jwt"
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
