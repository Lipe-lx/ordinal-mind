// wiki/contribute.ts — Handler for POST /api/wiki/contribute
// Pillar 2 — Chat Wiki Builder
//
// Receives a WikiContribution extracted from a chat session and persists it to D1.
// Status is auto-assigned based on og_tier:
//   genesis / og / community → published immediately
//   anon human writes        → rejected (auth required)
//   unsafe content           → quarantine (awaiting review)
//
// Consolidation:
// - One active contribution per (slug + field + contributor_key + active status)
// - Same normalized semantic value => duplicate/no-op
// - Different value => upsert in-place + audit trail in wiki_log

import type { Env } from "../index"
import type { JWTPayload, OGTier } from "../auth/jwt"
import { requireSessionUser } from "../auth/session"
import { enforceRateLimit, isTrustedWriteRequest } from "../security"
import type { PublicAuthorMode } from "../../app/lib/types"
import { normalizeWikiValue } from "../../app/lib/wikiNormalization"
import { checkContributionSafety } from "./safety"
import { getContributionColumnCaps, type ContributionColumnCaps } from "./contributionColumns"
import { resolvePublicAuthorMode } from "./publicAuthor"

export const CANONICAL_FIELDS = [
  "name",
  "founder",
  "artist",
  "inscriber",
  "launch_date",
  "launch_context",
  "origin_narrative",
  "community_culture",
  "connections",
  "current_status",
  "technical_details",
  "notable_moments",
] as const

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]

export function isCanonicalField(value: unknown): value is CanonicalField {
  return typeof value === "string" && (CANONICAL_FIELDS as readonly string[]).includes(value)
}

/** Regex for Bitcoin Inscription IDs: 64 hex chars followed by 'i' and a sequence number. */
const INSCRIPTION_ID_RE = /^[a-f0-9]{64}i[0-9]+$/i
const INSCRIPTION_ONLY_FIELDS: readonly CanonicalField[] = ["inscriber"]

export function isInscriptionId(slug: string): boolean {
  return INSCRIPTION_ID_RE.test(slug)
}

/**
 * Enforce field scope:
 * - inscription-only fields can only be written against inscription IDs
 * - all other canonical fields remain available for collections and inscriptions
 */
export function isFieldAllowedForSlug(field: CanonicalField, slug: string): boolean {
  if (!isCanonicalField(field)) return false
  if (INSCRIPTION_ONLY_FIELDS.includes(field)) {
    return isInscriptionId(slug)
  }
  return true
}

export interface WikiContributionInput {
  collection_slug: string
  field: CanonicalField
  value: string
  operation?: "add" | "delete"
  origin?: "narrative_seed_agent"
  confidence: "stated_by_user" | "inferred" | "correcting_existing"
  verifiable: boolean
  session_id: string
  source_excerpt?: string
  id?: string
  public_author_mode?: PublicAuthorMode
}

export interface ContributeRequest {
  contribution: WikiContributionInput
  /** Legacy no-op field kept for backward-compatible request parsing. */
  jwt?: string
}

export interface ContributeResponse {
  ok: boolean
  contribution_id: string
  status: "published" | "quarantine" | "duplicate" | "deleted"
  tier_applied: OGTier
  detail?: string
}

const NARRATIVE_SEED_ORIGIN = "narrative_seed_agent"
const SYSTEM_SEED_CONTRIBUTOR_ID = "system:narrative-seed-agent"
const SYSTEM_SEED_CONTRIBUTOR_KEY = "system:narrative-seed-agent"


interface ActiveContributionRow {
  id: string
  value: string
  value_norm: string | null
  status: string
  public_author_mode?: string | null
  public_author_username?: string | null
  public_author_avatar_url?: string | null
}

interface PublishedFieldRow extends ActiveContributionRow {
  og_tier: OGTier | string
  contributor_id: string | null
  contributor_key: string | null
}

function resolveStatus(tier: OGTier): "published" | "quarantine" {
  return tier === "community" || tier === "og" || tier === "genesis" ? "published" : "quarantine"
}

function buildContributorKey(contributorId: string | null, sessionId: string): string {
  return contributorId
    ? `user:${contributorId}`
    : `anon:${sessionId}`
}

function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `wc_${ts}_${rand}`
}

function isNarrativeSeedOrigin(value: unknown): value is typeof NARRATIVE_SEED_ORIGIN {
  return value === NARRATIVE_SEED_ORIGIN
}

function validateContributionInput(body: unknown): ContributeRequest | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>

  const contribution = b.contribution
  if (!contribution || typeof contribution !== "object") return null

  const c = contribution as Record<string, unknown>

  if (typeof c.collection_slug !== "string" || !c.collection_slug.trim()) return null
  if (!isCanonicalField(c.field)) return null

  const operation = c.operation === "delete" ? "delete" : "add"
  if (operation === "add" && (typeof c.value !== "string" || !c.value.trim())) return null

  if (
    c.confidence !== "stated_by_user"
    && c.confidence !== "inferred"
    && c.confidence !== "correcting_existing"
  ) return null
  if (typeof c.session_id !== "string" || !c.session_id) return null
  if (c.public_author_mode !== undefined && c.public_author_mode !== "anonymous" && c.public_author_mode !== "public") return null

  return {
    contribution: {
      collection_slug: (c.collection_slug as string).trim(),
      field: c.field,
      value: typeof c.value === "string" ? (c.value as string).trim() : "",
      operation,
      origin: isNarrativeSeedOrigin(c.origin) ? NARRATIVE_SEED_ORIGIN : undefined,
      confidence: c.confidence,
      verifiable: Boolean(c.verifiable),
      session_id: c.session_id as string,
      source_excerpt: typeof c.source_excerpt === "string" ? c.source_excerpt.slice(0, 500) : undefined,
      id: typeof c.id === "string" ? c.id.trim() : undefined,
      public_author_mode: resolvePublicAuthorMode(c.public_author_mode),
    },
    jwt: typeof b.jwt === "string" ? b.jwt : undefined,
  }
}

async function readActiveContribution(
  env: Env,
  slug: string,
  field: CanonicalField,
  contributorKey: string,
  status: "published" | "quarantine",
  caps: ContributionColumnCaps,
  contributorId: string | null,
  sessionId: string
): Promise<ActiveContributionRow | null> {
  if (!env.DB) return null

  const valueNormExpr = caps.hasValueNorm ? "value_norm" : "NULL AS value_norm"
  const publicAuthorModeExpr = caps.hasPublicAuthorMode ? "public_author_mode" : "'anonymous' AS public_author_mode"
  const publicAuthorUsernameExpr = caps.hasPublicAuthorUsername ? "public_author_username" : "NULL AS public_author_username"
  const publicAuthorAvatarExpr = caps.hasPublicAuthorAvatarUrl ? "public_author_avatar_url" : "NULL AS public_author_avatar_url"
  const row = caps.hasContributorKey
    ? await env.DB.prepare(`
    SELECT id, value, ${valueNormExpr}, status, ${publicAuthorModeExpr}, ${publicAuthorUsernameExpr}, ${publicAuthorAvatarExpr}
    FROM wiki_contributions
    WHERE collection_slug = ?
      AND field = ?
      AND contributor_key = ?
      AND status = ?
    LIMIT 1
  `)
      .bind(slug, field, contributorKey, status)
      .first<ActiveContributionRow>()
    : await env.DB.prepare(`
    SELECT id, value, ${valueNormExpr}, status, ${publicAuthorModeExpr}, ${publicAuthorUsernameExpr}, ${publicAuthorAvatarExpr}
    FROM wiki_contributions
    WHERE collection_slug = ?
      AND field = ?
      AND status = ?
      AND (
        (contributor_id IS NOT NULL AND contributor_id = ?)
        OR (? IS NULL AND contributor_id IS NULL AND session_id = ?)
      )
    LIMIT 1
  `)
      .bind(slug, field, status, contributorId, contributorId, sessionId)
      .first<ActiveContributionRow>()

  return row ?? null
}

function buildPublicAuthorSnapshot(payload: JWTPayload | null, mode: PublicAuthorMode): {
  mode: PublicAuthorMode
  username: string | null
  avatarUrl: string | null
} {
  if (!payload || mode !== "public") {
    return {
      mode: "anonymous",
      username: null,
      avatarUrl: null,
    }
  }

  return {
    mode: "public",
    username: payload.username,
    avatarUrl: payload.avatar,
  }
}

async function readPublishedFieldContribution(
  env: Env,
  slug: string,
  field: CanonicalField,
  caps: ContributionColumnCaps
): Promise<PublishedFieldRow | null> {
  if (!env.DB) return null
  const valueNormExpr = caps.hasValueNorm ? "value_norm" : "NULL AS value_norm"
  const contributorKeyExpr = caps.hasContributorKey ? "contributor_key" : "NULL AS contributor_key"
  const row = await env.DB.prepare(`
    SELECT id, value, ${valueNormExpr}, status, og_tier, contributor_id, ${contributorKeyExpr}
    FROM wiki_contributions
    WHERE collection_slug = ?
      AND field = ?
      AND status = 'published'
    ORDER BY
      CASE og_tier
        WHEN 'genesis' THEN 4
        WHEN 'og' THEN 3
        WHEN 'community' THEN 2
        ELSE 1
      END DESC,
      datetime(created_at) DESC,
      id DESC
    LIMIT 1
  `)
    .bind(slug, field)
    .first<PublishedFieldRow>()

  return row ?? null
}

async function writeConsolidationAudit(
  env: Env,
  payload: {
    contribution_id: string
    collection_slug: string
    field: CanonicalField
    contributor_key: string
    previous_value: string
    previous_value_norm: string
    next_value: string
    next_value_norm: string
    status: "published" | "quarantine"
    tier: OGTier
  }
): Promise<void> {
  if (!env.DB) return

  try {
    await env.DB.prepare(`
      INSERT INTO wiki_log (operation, slug, detail_json)
      VALUES ('contribution_consolidated', ?, ?)
    `)
      .bind(
        payload.collection_slug,
        JSON.stringify({
          at: new Date().toISOString(),
          contribution_id: payload.contribution_id,
          field: payload.field,
          contributor_key: payload.contributor_key,
          status: payload.status,
          tier: payload.tier,
          before: {
            value: payload.previous_value,
            value_norm: payload.previous_value_norm,
          },
          after: {
            value: payload.next_value,
            value_norm: payload.next_value_norm,
          },
        })
      )
      .run()
  } catch {
    // Audit log is best-effort only.
  }
}

async function invalidateConsolidatedCache(env: Env, slug: string): Promise<void> {
  if (!env.DB) return

  await env.DB.prepare(`
    DELETE FROM consolidated_cache WHERE collection_slug = ?
  `)
    .bind(slug)
    .run()
}

export async function handleContribute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  const requestUrl = new URL(request.url)
  if (!isTrustedWriteRequest(request, requestUrl, env.ALLOWED_ORIGINS)) {
    console.warn(JSON.stringify({ at: new Date().toISOString(), event: "security.write_origin_blocked", route: "/api/wiki/contribute" }))
    return json({ ok: false, error: "untrusted_origin" }, 403)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  const parsed = validateContributionInput(body)
  if (!parsed) {
    return json({ ok: false, error: "invalid_contribution_schema" }, 400)
  }

  const { contribution } = parsed
  const caps = await getContributionColumnCaps(env)
  const isSeedOrigin = contribution.origin === NARRATIVE_SEED_ORIGIN
  let authPayload: JWTPayload | null = null
  let contributor_id: string | null = null
  let tier: OGTier = "anon"

  if (!isSeedOrigin) {
    const auth = await requireSessionUser(request, env)
    if (!auth.ok) {
      return json({ ok: false, error: auth.error }, auth.status)
    }
    authPayload = auth.payload
    contributor_id = auth.payload.sub
    tier = auth.payload.tier
  }

  if (!isSeedOrigin) {
    const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
      keyPrefix: "wiki_contribute",
      limit: 40,
      windowSeconds: 60,
      alertThreshold: 30,
    })
    if (!rate.ok) {
      return json({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds }, 429)
    }
  }

  if (contribution.collection_slug.length > 140 || contribution.value.length > 2000 || contribution.session_id.length > 120) {
    return json({ ok: false, error: "payload_too_large" }, 413)
  }

  // Enforce field scope (Inscriber belongs to Inscriptions, Founder to Collections, etc.)
  if (!isFieldAllowedForSlug(contribution.field, contribution.collection_slug)) {
    return json({
      ok: false,
      error: "field_scope_mismatch",
      detail: `Field '${contribution.field}' is not allowed for ${isInscriptionId(contribution.collection_slug) ? "inscriptions" : "collections"}.`,
    }, 400)
  }

  if (contribution.operation === "delete") {
    if (tier !== "genesis") {
      return json({ ok: false, error: "forbidden_deletion_tier" }, 403)
    }

    try {
      // Mark all existing published contributions for this field as 'deleted'
      const deletionSet = caps.hasUpdatedAt
        ? "status = 'deleted', updated_at = datetime('now')"
        : "status = 'deleted'"
      
      if (contribution.id) {
        await env.DB.prepare(`
          UPDATE wiki_contributions
          SET ${deletionSet}
          WHERE id = ? AND status = 'published'
        `)
          .bind(contribution.id)
          .run()
      } else {
        await env.DB.prepare(`
          UPDATE wiki_contributions
          SET ${deletionSet}
          WHERE collection_slug = ? AND field = ? AND status = 'published'
        `)
          .bind(contribution.collection_slug, contribution.field)
          .run()
      }

      await invalidateConsolidatedCache(env, contribution.collection_slug)

      return json({
        ok: true,
        contribution_id: generateId(),
        status: "deleted",
        tier_applied: tier,
      })
    } catch (err) {
      console.error("[WikiContribute] Deletion failed:", err)
      return json({ ok: false, error: "db_deletion_failed" }, 500)
    }
  }

  const resolvedContributorId = isSeedOrigin ? SYSTEM_SEED_CONTRIBUTOR_ID : contributor_id
  const resolvedTier: OGTier = isSeedOrigin ? "genesis" : tier
  const contributorKey = isSeedOrigin
    ? SYSTEM_SEED_CONTRIBUTOR_KEY
    : buildContributorKey(contributor_id, contribution.session_id)
  const status: "published" | "quarantine" = resolveStatus(resolvedTier)
  const valueNorm = normalizeWikiValue(contribution.value)
  const publicAuthor = buildPublicAuthorSnapshot(authPayload, isSeedOrigin ? "anonymous" : (contribution.public_author_mode ?? "anonymous"))

  const safety = isSeedOrigin
    ? {
        safe: true,
        confidence: 1,
        reason: "trusted_narrative_seed_agent",
        metadata: { origin: NARRATIVE_SEED_ORIGIN, mode: "system_genesis_autopublish" },
      }
    : await checkContributionSafety(contribution.value, env)
  
  // If flagged as unsafe, force quarantine even for Genesis/OG
  const effectiveStatus: "published" | "quarantine" = isSeedOrigin
    ? "published"
    : (safety.safe ? status : "quarantine")

  let activeRow: ActiveContributionRow | null
  let publishedFieldRow: PublishedFieldRow | null = null
  try {
    if (isSeedOrigin) {
      publishedFieldRow = await readPublishedFieldContribution(
        env,
        contribution.collection_slug,
        contribution.field,
        caps
      )
      activeRow = publishedFieldRow
    } else {
      activeRow = await readActiveContribution(
        env,
        contribution.collection_slug,
        contribution.field,
        contributorKey,
        effectiveStatus,
        caps,
        contributor_id,
        contribution.session_id
      )
    }
  } catch (err) {
    console.error("[WikiContribute] Failed to read active contribution:", err)
    return json({ ok: false, error: "db_read_failed" }, 500)
  }

  if (activeRow) {
    const currentNorm = normalizeWikiValue(
      (typeof activeRow.value_norm === "string" && activeRow.value_norm)
      || (typeof activeRow.value === "string" ? activeRow.value : contribution.value)
    )
    const currentPublicAuthorMode = resolvePublicAuthorMode(activeRow.public_author_mode)
    const samePublicAuthorPreference = currentPublicAuthorMode === publicAuthor.mode
      && (activeRow.public_author_username ?? null) === publicAuthor.username
      && (activeRow.public_author_avatar_url ?? null) === publicAuthor.avatarUrl

    if (currentNorm === valueNorm && samePublicAuthorPreference) {
      const duplicateResponse: ContributeResponse = {
        ok: true,
        contribution_id: activeRow.id,
        status: "duplicate",
        tier_applied: resolvedTier,
      }
      return json(duplicateResponse)
    }

    if (
      isSeedOrigin
      && publishedFieldRow
      && publishedFieldRow.og_tier === "genesis"
      && publishedFieldRow.contributor_key !== SYSTEM_SEED_CONTRIBUTOR_KEY
    ) {
      console.info("[WikiContribute] Seed write skipped due to genesis human protection", {
        at: new Date().toISOString(),
        slug: contribution.collection_slug,
        field: contribution.field,
        contribution_id: publishedFieldRow.id,
      })
      const protectedResponse: ContributeResponse = {
        ok: true,
        contribution_id: publishedFieldRow.id,
        status: "duplicate",
        tier_applied: resolvedTier,
        detail: "protected_genesis_human",
      }
      return json(protectedResponse)
    }

    try {
      const updateParts: string[] = [
        "value = ?",
        "confidence = ?",
        "verifiable = ?",
        "contributor_id = ?",
        "og_tier = ?",
        "session_id = ?",
        "source_excerpt = ?",
      ]
      const updateBind: unknown[] = [
        contribution.value,
        contribution.confidence,
        contribution.verifiable ? 1 : 0,
        resolvedContributorId,
        resolvedTier,
        contribution.session_id,
        contribution.source_excerpt ?? null,
      ]
      if (caps.hasPublicAuthorMode) {
        updateParts.push("public_author_mode = ?")
        updateBind.push(publicAuthor.mode)
      }
      if (caps.hasPublicAuthorUsername) {
        updateParts.push("public_author_username = ?")
        updateBind.push(publicAuthor.username)
      }
      if (caps.hasPublicAuthorAvatarUrl) {
        updateParts.push("public_author_avatar_url = ?")
        updateBind.push(publicAuthor.avatarUrl)
      }
      if (caps.hasValueNorm) {
        updateParts.push("value_norm = ?")
        updateBind.push(valueNorm)
      }
      if (caps.hasContributorKey) {
        updateParts.push("contributor_key = ?")
        updateBind.push(contributorKey)
      }
      if (caps.hasSafetyStatus) {
        updateParts.push("safety_status = ?")
        updateBind.push(safety.safe ? "safe" : "flagged")
      }
      if (caps.hasSafetyMetadata) {
        updateParts.push("safety_metadata = ?")
        updateBind.push(safety.metadata ? JSON.stringify(safety.metadata) : (safety.reason || null))
      }
      if (caps.hasUpdatedAt) {
        updateParts.push("updated_at = datetime('now')")
      }

      await env.DB.prepare(`
        UPDATE wiki_contributions
        SET ${updateParts.join(", ")}
        WHERE id = ?
      `)
        .bind(...updateBind, activeRow.id)
        .run()

      await writeConsolidationAudit(env, {
        contribution_id: activeRow.id,
        collection_slug: contribution.collection_slug,
        field: contribution.field,
        contributor_key: contributorKey,
        previous_value: typeof activeRow.value === "string" ? activeRow.value : "",
        previous_value_norm: currentNorm,
        next_value: contribution.value,
        next_value_norm: valueNorm,
        status: effectiveStatus,
        tier: resolvedTier,
      })

      if (effectiveStatus === "published") {
        await invalidateConsolidatedCache(env, contribution.collection_slug)
      }
    } catch (err) {
      console.error("[WikiContribute] D1 consolidation update failed:", err)
      return json({ ok: false, error: "db_write_failed" }, 500)
    }

    const consolidatedResponse: ContributeResponse = {
      ok: true,
      contribution_id: activeRow.id,
      status: effectiveStatus,
      tier_applied: resolvedTier,
    }

    return json(consolidatedResponse)
  }

  const id = generateId()

  try {
    const insertColumns = [
      "id",
      "collection_slug",
      "field",
      "value",
      "confidence",
      "verifiable",
      "contributor_id",
      "og_tier",
      "session_id",
      "source_excerpt",
      "status",
    ]
    const insertValues = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"]
    const insertBind: unknown[] = [
      id,
      contribution.collection_slug,
      contribution.field,
      contribution.value,
      contribution.confidence,
      contribution.verifiable ? 1 : 0,
      resolvedContributorId,
      resolvedTier,
      contribution.session_id,
      contribution.source_excerpt ?? null,
      effectiveStatus,
    ]
    if (caps.hasPublicAuthorMode) {
      insertColumns.push("public_author_mode")
      insertValues.push("?")
      insertBind.push(publicAuthor.mode)
    }
    if (caps.hasPublicAuthorUsername) {
      insertColumns.push("public_author_username")
      insertValues.push("?")
      insertBind.push(publicAuthor.username)
    }
    if (caps.hasPublicAuthorAvatarUrl) {
      insertColumns.push("public_author_avatar_url")
      insertValues.push("?")
      insertBind.push(publicAuthor.avatarUrl)
    }

    if (caps.hasValueNorm) {
      insertColumns.push("value_norm")
      insertValues.push("?")
      insertBind.push(valueNorm)
    }
    if (caps.hasContributorKey) {
      insertColumns.push("contributor_key")
      insertValues.push("?")
      insertBind.push(contributorKey)
    }
    if (caps.hasSafetyStatus) {
      insertColumns.push("safety_status")
      insertValues.push("?")
      insertBind.push(safety.safe ? "safe" : "flagged")
    }
    if (caps.hasSafetyMetadata) {
      insertColumns.push("safety_metadata")
      insertValues.push("?")
      insertBind.push(safety.metadata ? JSON.stringify(safety.metadata) : (safety.reason || null))
    }
    if (caps.hasUpdatedAt) {
      insertColumns.push("updated_at")
      insertValues.push("datetime('now')")
    }

    await env.DB.prepare(`
      INSERT INTO wiki_contributions
        (${insertColumns.join(", ")})
      VALUES (${insertValues.join(", ")})
    `)
      .bind(...insertBind)
      .run()

    if (effectiveStatus === "published") {
      await invalidateConsolidatedCache(env, contribution.collection_slug)
    }
  } catch (err) {
    console.error("[WikiContribute] D1 insert failed:", err)
    return json({ ok: false, error: "db_write_failed" }, 500)
  }

  const response: ContributeResponse = {
    ok: true,
    contribution_id: id,
    status: effectiveStatus,
    tier_applied: resolvedTier,
  }

  return json(response)
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
