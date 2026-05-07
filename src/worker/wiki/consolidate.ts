// wiki/consolidate.ts — Pillar 3 Canonical Consolidation Engine
//
// Computes consensus across all published contributions for a collection.
//
// Tier hierarchy for conflict resolution:
// genesis (weight 4) > og (weight 3) > community (weight 2) > anon (weight 1)
//
// Rules:
// 1. Genesis contribution is always canonical.
// 2. Uncontested OG contribution is canonical.
// 3. Multiple OGs with different values -> disputed.
// 4. Community/anon only -> draft.

import type { Env } from "../index"
import { CANONICAL_FIELDS, isFieldAllowedForSlug, isInscriptionId, type CanonicalField } from "./contribute"
import { normalizeWikiValue } from "../../app/lib/wikiNormalization"
import type {
  ConsolidatedCollection,
  ConsolidatedField,
  ConsensusContribution,
  ContributionStatus,
} from "../../app/lib/types"

const TIER_WEIGHTS: Record<string, number> = {
  genesis: 4,
  og: 3,
  community: 2,
  anon: 1,
}

interface DBContributionRow {
  id: string
  field: CanonicalField
  value: string
  value_norm?: string | null
  contributor_id: string | null
  og_tier: string
  created_at: string
}

function deduplicateByNormalizedValue(rows: DBContributionRow[]): DBContributionRow[] {
  if (rows.length <= 1) return rows

  const byNorm = new Map<string, DBContributionRow[]>()
  for (const row of rows) {
    const norm = normalizeWikiValue(row.value_norm ?? row.value)
    const list = byNorm.get(norm) ?? []
    list.push(row)
    byNorm.set(norm, list)
  }

  const deduped: DBContributionRow[] = []
  for (const candidates of byNorm.values()) {
    const best = [...candidates].sort((left, right) => {
      const leftWeight = TIER_WEIGHTS[left.og_tier] ?? 1
      const rightWeight = TIER_WEIGHTS[right.og_tier] ?? 1
      if (leftWeight !== rightWeight) return rightWeight - leftWeight

      const timeDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      if (timeDiff !== 0) return timeDiff

      return right.id.localeCompare(left.id)
    })[0]

    if (best) deduped.push(best)
  }

  return deduped
}

export async function buildConsolidation(slug: string, env: Env): Promise<ConsolidatedCollection> {
  if (!env.DB) throw new Error("wiki_db_unavailable")

  const rows = await env.DB.prepare(`
    SELECT id, field, value, value_norm, contributor_id, og_tier, created_at
    FROM wiki_contributions
    WHERE collection_slug = ? AND status = 'published'
  `)
    .bind(slug)
    .all<DBContributionRow>()

  const contributionsByField = new Map<CanonicalField, DBContributionRow[]>()
  const allowedFields = CANONICAL_FIELDS.filter(f => isFieldAllowedForSlug(f, slug))
  allowedFields.forEach(f => contributionsByField.set(f, []))

  const sources: ConsolidatedCollection["sources"] = []

  for (const row of rows.results ?? []) {
    const list = contributionsByField.get(row.field)
    if (list) {
      list.push(row)
      sources.push({
        contributor_id: row.contributor_id,
        og_tier: row.og_tier,
        field: row.field,
        created_at: row.created_at,
      })
    }
  }

  const narrative: Record<string, ConsolidatedField> = {}
  const gaps: string[] = []
  let totalConfidence = 0
  let filledCount = 0

  for (const field of allowedFields) {
    const originalFieldRows = contributionsByField.get(field) ?? []
    const fieldRows = deduplicateByNormalizedValue(originalFieldRows)

    if (fieldRows.length === 0) {
      gaps.push(field)
      narrative[field] = {
        field,
        canonical_value: null,
        status: "draft",
        contributions: [],
        resolved_by_tier: "none",
      }
      continue
    }

    const contributions: ConsensusContribution[] = fieldRows.map(r => ({
      value: r.value,
      contributor_id: r.contributor_id,
      og_tier: r.og_tier,
      weight: TIER_WEIGHTS[r.og_tier] ?? 1,
      created_at: r.created_at,
    }))

    // Sort by weight desc, then latest
    contributions.sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (timeDiff !== 0) return timeDiff
      return b.value.localeCompare(a.value)
    })

    const topContrib = contributions[0]
    const topWeight = topContrib.weight

    let status: ContributionStatus
    const canonicalValue: string | null = topContrib.value

    if (topWeight >= TIER_WEIGHTS.genesis) {
      status = "canonical"
    } else if (topWeight === TIER_WEIGHTS.og) {
      // Check for dispute: another OG with a different semantic value
      const topNorm = normalizeWikiValue(topContrib.value)
      const otherOgs = contributions.filter(
        (c) => c.weight === TIER_WEIGHTS.og && normalizeWikiValue(c.value) !== topNorm
      )
      if (otherOgs.length > 0) {
        status = "disputed"
      } else {
        status = "canonical"
      }
    } else {
      // Community or anon -> draft
      status = "draft"
    }

    narrative[field] = {
      field,
      canonical_value: status === "disputed" ? null : canonicalValue,
      status,
      contributions,
      resolved_by_tier: status === "disputed" ? "disputed" : topContrib.og_tier,
    }

    filledCount++
    totalConfidence += topWeight / 4 // Normalize confidence to 0-1 based on top tier weight
  }

  const total = allowedFields.length
  const score = total > 0 ? filledCount / total : 0
  const averageConfidence = filledCount > 0 ? totalConfidence / filledCount : 0

  let stats: { count: number; first_seen: string | null; last_seen: string | null; inscription_id: string | null } | null

  if (isInscriptionId(slug)) {
    // 4.1 Factual stats for a single inscription
    stats = await env.DB.prepare(`
      SELECT 1 as count, timestamp as first_seen, timestamp as last_seen, inscription_id
      FROM raw_chronicle_events
      WHERE inscription_id = ? AND event_type = 'genesis'
      LIMIT 1
    `)
      .bind(slug)
      .first()
  } else {
    // 4.2 Factual stats for a collection (members matched via collection_link)
    stats = await env.DB.prepare(`
      SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen, inscription_id
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
      .bind(slug, slug)
      .first()
  }

  return {
    collection_slug: slug,
    sample_inscription_id: stats?.inscription_id ?? null,
    completeness: {
      filled: filledCount,
      total,
      score: Math.round(score * 1000) / 1000,
    },
    confidence: Math.round(averageConfidence * 1000) / 1000,
    factual: stats ? {
      supply: stats.count > 0 ? stats.count : null,
      first_seen: stats.first_seen,
      last_seen: stats.last_seen,
    } : null,
    narrative,
    sources,
    gaps,
  }
}
