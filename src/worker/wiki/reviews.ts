import type { Env } from "../index"
import type { OGTier } from "../auth/jwt"
import { requireSessionUser } from "../auth/session"
import { enforceRateLimit, isTrustedWriteRequest } from "../security"

interface ReviewActor {
  discordId: string
  username: string
  tier: OGTier
}

interface PendingReviewRow {
  id: string
  collection_slug: string
  field: string
  value: string
  confidence: string
  verifiable: number
  contributor_id: string | null
  og_tier: string
  session_id: string
  source_excerpt: string | null
  created_at: string
  contributor_username: string | null
  current_value: string | null
  current_tier: string | null
  safety_status: string
  safety_metadata: string | null
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

async function requireGenesisReviewer(request: Request, env: Env): Promise<ReviewActor | Response> {
  const auth = await requireSessionUser(request, env)
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status)
  }

  if (auth.payload.tier !== "genesis") {
    return json({ ok: false, error: "genesis_review_required" }, 403)
  }

  return {
    discordId: auth.payload.sub,
    username: auth.payload.username,
    tier: auth.payload.tier,
  }
}

function toTierOrderSql(alias: string): string {
  return `CASE ${alias}.og_tier
    WHEN 'genesis' THEN 4
    WHEN 'og' THEN 3
    WHEN 'community' THEN 2
    ELSE 1
  END`
}

async function queryPendingRows(env: Env, limit: number): Promise<PendingReviewRow[]> {
  if (!env.DB) return []

  const sqlWithUsers = `
    SELECT
      wc.id,
      wc.collection_slug,
      wc.field,
      wc.value,
      wc.confidence,
      wc.verifiable,
      wc.contributor_id,
      wc.og_tier,
      wc.session_id,
      wc.source_excerpt,
      wc.created_at,
      wc.safety_status,
      wc.safety_metadata,
      u.username AS contributor_username,
      (
        SELECT wc2.value
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_value,
      (
        SELECT wc2.og_tier
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_tier
    FROM wiki_contributions wc
    LEFT JOIN users u ON u.discord_id = wc.contributor_id
    WHERE wc.status = 'quarantine'
    ORDER BY wc.created_at DESC
    LIMIT ?
  `

  try {
    const rows = await env.DB.prepare(sqlWithUsers).bind(limit).all<PendingReviewRow>()
    return rows.results ?? []
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    const msg = error.message.toLowerCase()
    if (!msg.includes("no such table: users") && !msg.includes("no such column: wc.safety_status") && !msg.includes("no such column: wc.safety_metadata")) {
      throw error
    }
  }

  const sqlFallback = `
    SELECT
      wc.id,
      wc.collection_slug,
      wc.field,
      wc.value,
      wc.confidence,
      wc.verifiable,
      wc.contributor_id,
      wc.og_tier,
      wc.session_id,
      wc.source_excerpt,
      wc.created_at,
      wc.safety_status,
      wc.safety_metadata,
      NULL AS contributor_username,
      (
        SELECT wc2.value
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_value,
      (
        SELECT wc2.og_tier
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_tier
    FROM wiki_contributions wc
    WHERE wc.status = 'quarantine'
    ORDER BY wc.created_at DESC
    LIMIT ?
  `

  try {
    const rows = await env.DB.prepare(sqlFallback).bind(limit).all<PendingReviewRow>()
    return rows.results ?? []
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const msg = error.message.toLowerCase()
    if (!msg.includes("no such column: wc.safety_status") && !msg.includes("no such column: wc.safety_metadata")) {
      throw error
    }
  }

  const sqlLegacyFallback = `
    SELECT
      wc.id,
      wc.collection_slug,
      wc.field,
      wc.value,
      wc.confidence,
      wc.verifiable,
      wc.contributor_id,
      wc.og_tier,
      wc.session_id,
      wc.source_excerpt,
      wc.created_at,
      NULL AS contributor_username,
      (
        SELECT wc2.value
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_value,
      (
        SELECT wc2.og_tier
        FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wc.collection_slug
          AND wc2.field = wc.field
          AND wc2.status = 'published'
        ORDER BY ${toTierOrderSql("wc2")} DESC, wc2.created_at DESC
        LIMIT 1
      ) AS current_tier,
      'safe' AS safety_status,
      NULL AS safety_metadata
    FROM wiki_contributions wc
    WHERE wc.status = 'quarantine'
    ORDER BY wc.created_at DESC
    LIMIT ?
  `

  const rows = await env.DB.prepare(sqlLegacyFallback).bind(limit).all<PendingReviewRow>()
  return rows.results ?? []
}

export async function handlePendingReviews(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url)
  if (!isTrustedWriteRequest(request, requestUrl, env.ALLOWED_ORIGINS)) {
    return json({ ok: false, error: "untrusted_origin" }, 403)
  }

  const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
    keyPrefix: "wiki_reviews_pending",
    limit: 90,
    windowSeconds: 60,
    alertThreshold: 70,
  })
  if (!rate.ok) {
    return json({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds }, 429)
  }

  const reviewer = await requireGenesisReviewer(request, env)
  if (reviewer instanceof Response) return reviewer

  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  try {
    const countRow = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM wiki_contributions
      WHERE status = 'quarantine'
    `).first<{ count: number }>()

    const pendingCount = Number(countRow?.count ?? 0)
    const rows = await queryPendingRows(env, 50)

    return json({
      ok: true,
      reviewer: {
        discord_id: reviewer.discordId,
        username: reviewer.username,
        tier: reviewer.tier,
      },
      pending_count: pendingCount,
      items: rows.map((row) => ({
        id: row.id,
        collection_slug: row.collection_slug,
        field: row.field,
        proposed_value: row.value,
        confidence: row.confidence,
        verifiable: Boolean(row.verifiable),
        contributor_id: row.contributor_id,
        contributor_username: row.contributor_username,
        contributor_tier: row.og_tier,
        session_id: row.session_id,
        source_excerpt: row.source_excerpt,
        created_at: row.created_at,
        safety_status: row.safety_status,
        safety_metadata: row.safety_metadata,
        current_value: row.current_value,
        current_tier: row.current_tier,
      })),
    })
  } catch (error) {
    console.error("[WikiReviews] pending query failed:", error)
    return json({ ok: false, error: "wiki_reviews_unavailable", partial: true }, 200)
  }
}

export async function handleReviewDecision(
  request: Request,
  env: Env,
  reviewId: string
): Promise<Response> {
  const requestUrl = new URL(request.url)
  if (!isTrustedWriteRequest(request, requestUrl, env.ALLOWED_ORIGINS)) {
    return json({ ok: false, error: "untrusted_origin" }, 403)
  }

  const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
    keyPrefix: "wiki_review_decision",
    limit: 50,
    windowSeconds: 60,
    alertThreshold: 30,
  })
  if (!rate.ok) {
    return json({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds }, 429)
  }

  const reviewer = await requireGenesisReviewer(request, env)
  if (reviewer instanceof Response) return reviewer

  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  const action = typeof (body as Record<string, unknown>)?.action === "string"
    ? String((body as Record<string, unknown>).action)
    : ""

  if (action !== "approve" && action !== "reject") {
    return json({ ok: false, error: "invalid_review_action" }, 400)
  }

  const row = await env.DB.prepare(`
    SELECT id, collection_slug, field, value
    FROM wiki_contributions
    WHERE id = ?
      AND status = 'quarantine'
    LIMIT 1
  `)
    .bind(reviewId)
    .first<{ id: string; collection_slug: string; field: string; value: string }>()

  if (!row) {
    return json({ ok: false, error: "review_item_not_found" }, 404)
  }

  const nextStatus = action === "approve" ? "published" : "rejected"

  await env.DB.prepare(`
    UPDATE wiki_contributions
    SET status = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `)
    .bind(nextStatus, reviewId)
    .run()

  if (action === "approve") {
    await env.DB.prepare(`
      DELETE FROM consolidated_cache
      WHERE collection_slug = ?
    `)
      .bind(row.collection_slug)
      .run()
  }

  return json({
    ok: true,
    review_id: reviewId,
    action,
    status: nextStatus,
    reviewer: {
      discord_id: reviewer.discordId,
      username: reviewer.username,
      tier: reviewer.tier,
    },
    item: {
      collection_slug: row.collection_slug,
      field: row.field,
      proposed_value: row.value,
    },
  })
}
