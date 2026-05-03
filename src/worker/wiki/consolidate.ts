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
import { CANONICAL_FIELDS, type CanonicalField } from "./contribute"
import type { 
  ConsolidatedCollection, 
  ConsolidatedField, 
  ConsensusContribution, 
  ContributionStatus 
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
  contributor_id: string | null
  og_tier: string
  created_at: string
}

export async function buildConsolidation(slug: string, env: Env): Promise<ConsolidatedCollection> {
  if (!env.DB) throw new Error("wiki_db_unavailable")

  const rows = await env.DB.prepare(`
    SELECT id, field, value, contributor_id, og_tier, created_at
    FROM wiki_contributions
    WHERE collection_slug = ? AND status = 'published'
  `)
    .bind(slug)
    .all<DBContributionRow>()

  const contributionsByField = new Map<CanonicalField, DBContributionRow[]>()
  CANONICAL_FIELDS.forEach(f => contributionsByField.set(f, []))

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

  for (const field of CANONICAL_FIELDS) {
    const fieldRows = contributionsByField.get(field) ?? []
    
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
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    const topContrib = contributions[0]
    const topWeight = topContrib.weight

    let status: ContributionStatus
    const canonicalValue: string | null = topContrib.value

    if (topWeight >= TIER_WEIGHTS.genesis) {
      status = "canonical"
    } else if (topWeight === TIER_WEIGHTS.og) {
      // Check for dispute: another OG with a different value
      const otherOgs = contributions.filter(c => c.weight === TIER_WEIGHTS.og && c.value !== topContrib.value)
      if (otherOgs.length > 0) {
        status = "disputed"
        // In dispute, we don't have a firm canonical value
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

  const total = CANONICAL_FIELDS.length
  const score = total > 0 ? filledCount / total : 0
  const averageConfidence = filledCount > 0 ? totalConfidence / filledCount : 0

  return {
    collection_slug: slug,
    completeness: {
      filled: filledCount,
      total,
      score: Math.round(score * 1000) / 1000,
    },
    confidence: Math.round(averageConfidence * 1000) / 1000,
    factual: null, // Merged on the frontend
    narrative,
    sources,
    gaps,
  }
}
