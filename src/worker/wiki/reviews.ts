import type { Env } from "../index"
import type { OGTier } from "../auth/jwt"
import { requireSessionUser } from "../auth/session"
import { enforceRateLimit, isTrustedWriteRequest } from "../security"
import { getContributionColumnCaps, type ContributionColumnCaps } from "./contributionColumns"

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

interface ReviewDecisionRow {
  id: string
  collection_slug: string
  field: string
  value: string
  contributor_id: string | null
  contributor_key: string | null
  session_id: string | null
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

  const columnCaps = await getContributionColumnCaps(env)
  const row = await env.DB.prepare(`
    SELECT
      id,
      collection_slug,
      field,
      value,
      contributor_id,
      ${columnCaps.hasContributorKey ? "contributor_key" : "NULL AS contributor_key"},
      session_id
    FROM wiki_contributions
    WHERE id = ?
      AND status = 'quarantine'
    LIMIT 1
  `)
    .bind(reviewId)
    .first<ReviewDecisionRow>()

  if (!row) {
    return json({ ok: false, error: "review_item_not_found" }, 404)
  }

  const nextStatus = action === "approve" ? "published" : "rejected"

  try {
    if (action === "approve") {
      await retirePublishedContributionConflicts(env, row, columnCaps)
    }

    await updateReviewedContributionStatus(env, reviewId, nextStatus, columnCaps)

    if (action === "approve") {
      await clearConsolidatedCacheBestEffort(env, row.collection_slug)
    }
  } catch (error) {
    console.error("[WikiReviews] review decision failed:", {
      reviewId,
      action,
      error,
    })
    return json({ ok: false, error: "review_action_failed" }, 500)
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

async function retirePublishedContributionConflicts(
  env: Env,
  row: ReviewDecisionRow,
  columnCaps: ContributionColumnCaps
): Promise<void> {
  const setClause = buildStatusUpdateClause("'duplicate'", columnCaps, true)

  if (columnCaps.hasContributorKey && row.contributor_key) {
    await env.DB!.prepare(`
      UPDATE wiki_contributions
      SET ${setClause}
      WHERE collection_slug = ?
        AND field = ?
        AND contributor_key = ?
        AND status = 'published'
        AND id <> ?
    `)
      .bind(row.collection_slug, row.field, row.contributor_key, row.id)
      .run()
    return
  }

  if (row.contributor_id) {
    await env.DB!.prepare(`
      UPDATE wiki_contributions
      SET ${setClause}
      WHERE collection_slug = ?
        AND field = ?
        AND contributor_id = ?
        AND status = 'published'
        AND id <> ?
    `)
      .bind(row.collection_slug, row.field, row.contributor_id, row.id)
      .run()
    return
  }

  if (!row.session_id) {
    return
  }

  await env.DB!.prepare(`
    UPDATE wiki_contributions
    SET ${setClause}
    WHERE collection_slug = ?
      AND field = ?
      AND contributor_id IS NULL
      AND session_id = ?
      AND status = 'published'
      AND id <> ?
  `)
    .bind(row.collection_slug, row.field, row.session_id, row.id)
    .run()
}

async function updateReviewedContributionStatus(
  env: Env,
  reviewId: string,
  nextStatus: string,
  columnCaps: ContributionColumnCaps
): Promise<void> {
  const primarySetClause = buildStatusUpdateClause("?", columnCaps, false)
  try {
    await env.DB!.prepare(`
      UPDATE wiki_contributions
      SET ${primarySetClause}
      WHERE id = ?
    `)
      .bind(nextStatus, reviewId)
      .run()
    return
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    const msg = error.message.toLowerCase()
    if (!msg.includes("no such column: reviewed_at") && !msg.includes("no such column: updated_at")) {
      throw error
    }
  }

  const fallbackSetClause = columnCaps.hasUpdatedAt
    ? "status = ?, updated_at = datetime('now')"
    : "status = ?"
  await env.DB!.prepare(`
    UPDATE wiki_contributions
    SET ${fallbackSetClause}
    WHERE id = ?
  `)
    .bind(nextStatus, reviewId)
    .run()
}

function buildStatusUpdateClause(
  statusValueSql: string,
  columnCaps: ContributionColumnCaps,
  preserveReviewedAt: boolean
): string {
  const clauses = [`status = ${statusValueSql}`]
  if (columnCaps.hasUpdatedAt) {
    clauses.push("updated_at = datetime('now')")
  }
  clauses.push(preserveReviewedAt ? "reviewed_at = COALESCE(reviewed_at, datetime('now'))" : "reviewed_at = datetime('now')")
  return clauses.join(", ")
}

async function clearConsolidatedCacheBestEffort(env: Env, collectionSlug: string): Promise<void> {
  try {
    await env.DB!.prepare(`
      DELETE FROM consolidated_cache
      WHERE collection_slug = ?
    `)
      .bind(collectionSlug)
      .run()
  } catch (error) {
    if (!(error instanceof Error)) {
      console.warn("[WikiReviews] cache clear skipped:", error)
      return
    }
    if (!error.message.toLowerCase().includes("no such table: consolidated_cache")) {
      throw error
    }
    console.warn("[WikiReviews] cache clear skipped: consolidated_cache missing")
  }
}
