// wiki/contribute.ts — Handler for POST /api/wiki/contribute
// Pillar 2 — Chat Wiki Builder
//
// Receives a WikiContribution extracted from a chat session and persists it to D1.
// Status is auto-assigned based on og_tier:
//   genesis / og  → published immediately
//   community / anon → quarantine (awaiting review)
//
// Deduplication: same collection_slug + field + value → status = 'duplicate'

import type { Env } from "../index"
import { verifyJWT } from "../auth/jwt"
import type { OGTier } from "../auth/jwt"

/** The 11 canonical fields for a collection wiki page. */
export const CANONICAL_FIELDS = [
  "founder",
  "artist",
  "inscriber",
  "launch_date",
  "launch_context",
  "origin_narrative",
  "technical_details",
  "notable_moments",
  "community_culture",
  "connections",
  "current_status",
] as const

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]

export function isCanonicalField(value: unknown): value is CanonicalField {
  return typeof value === "string" && (CANONICAL_FIELDS as readonly string[]).includes(value)
}

export interface WikiContributionInput {
  collection_slug: string
  field: CanonicalField
  value: string
  confidence: "stated_by_user" | "inferred" | "correcting_existing"
  verifiable: boolean
  session_id: string
  source_excerpt?: string
}

export interface ContributeRequest {
  contribution: WikiContributionInput
  jwt?: string
}

export interface ContributeResponse {
  ok: boolean
  contribution_id: string
  status: "published" | "quarantine" | "duplicate"
  tier_applied: OGTier
}

type ContributionStatus = "published" | "quarantine" | "duplicate"

function resolveStatus(tier: OGTier): "published" | "quarantine" {
  return tier === "og" || tier === "genesis" ? "published" : "quarantine"
}

function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `wc_${ts}_${rand}`
}

function validateContributionInput(body: unknown): ContributeRequest | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>

  const contribution = b.contribution
  if (!contribution || typeof contribution !== "object") return null

  const c = contribution as Record<string, unknown>

  if (typeof c.collection_slug !== "string" || !c.collection_slug.trim()) return null
  if (!isCanonicalField(c.field)) return null
  if (typeof c.value !== "string" || !c.value.trim()) return null
  if (
    c.confidence !== "stated_by_user" &&
    c.confidence !== "inferred" &&
    c.confidence !== "correcting_existing"
  ) return null
  if (typeof c.session_id !== "string" || !c.session_id) return null

  return {
    contribution: {
      collection_slug: (c.collection_slug as string).trim(),
      field: c.field,
      value: (c.value as string).trim(),
      confidence: c.confidence,
      verifiable: Boolean(c.verifiable),
      session_id: c.session_id as string,
      source_excerpt: typeof c.source_excerpt === "string" ? c.source_excerpt.slice(0, 500) : undefined,
    },
    jwt: typeof b.jwt === "string" ? b.jwt : undefined,
  }
}

async function resolveContributor(
  jwt: string | undefined,
  env: Env
): Promise<{ contributor_id: string | null; tier: OGTier }> {
  if (!jwt || !env.JWT_SECRET) {
    return { contributor_id: null, tier: "anon" }
  }

  const payload = await verifyJWT(jwt, env.JWT_SECRET)
  if (!payload) {
    return { contributor_id: null, tier: "anon" }
  }

  return { contributor_id: payload.sub, tier: payload.tier }
}

async function checkDuplicate(
  env: Env,
  slug: string,
  field: CanonicalField,
  value: string
): Promise<boolean> {
  if (!env.DB) return false
  try {
    const row = await env.DB.prepare(`
      SELECT id FROM wiki_contributions
      WHERE collection_slug = ? AND field = ? AND value = ?
      LIMIT 1
    `)
      .bind(slug, field, value)
      .first<{ id: string }>()
    return Boolean(row)
  } catch {
    return false
  }
}

export async function handleContribute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
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

  const { contribution, jwt } = parsed
  const { contributor_id, tier } = await resolveContributor(jwt, env)

  // Deduplication check
  const isDuplicate = await checkDuplicate(env, contribution.collection_slug, contribution.field, contribution.value)
  if (isDuplicate) {
    const fakeId = generateId()
    const response: ContributeResponse = {
      ok: true,
      contribution_id: fakeId,
      status: "duplicate",
      tier_applied: tier,
    }
    return json(response)
  }

  const id = generateId()
  const status: ContributionStatus = resolveStatus(tier)

  try {
    await env.DB.prepare(`
      INSERT INTO wiki_contributions
        (id, collection_slug, field, value, confidence, verifiable,
         contributor_id, og_tier, session_id, source_excerpt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        id,
        contribution.collection_slug,
        contribution.field,
        contribution.value,
        contribution.confidence,
        contribution.verifiable ? 1 : 0,
        contributor_id,
        tier,
        contribution.session_id,
        contribution.source_excerpt ?? null,
        status,
      )
      .run()

    if (status === "published") {
      await env.DB.prepare(`
        DELETE FROM consolidated_cache WHERE collection_slug = ?
      `)
        .bind(contribution.collection_slug)
        .run()
    }
  } catch (err) {
    console.error("[WikiContribute] D1 insert failed:", err)
    return json({ ok: false, error: "db_write_failed" }, 500)
  }

  const response: ContributeResponse = {
    ok: true,
    contribution_id: id,
    status,
    tier_applied: tier,
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
