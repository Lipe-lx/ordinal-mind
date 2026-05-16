import type { ConsolidatedCollection, ConsensusContribution, PublicAuthor, PublicAuthorMode } from "../../app/lib/types"

export function resolvePublicAuthorMode(value: unknown): PublicAuthorMode {
  return value === "public" ? "public" : "anonymous"
}

export function buildPublicAuthorSnapshot(params: {
  mode: unknown
  username: unknown
  avatarUrl: unknown
}): PublicAuthor | null {
  if (resolvePublicAuthorMode(params.mode) !== "public") return null
  if (typeof params.username !== "string" || !params.username.trim()) return null
  return {
    mode: "public",
    username: params.username.trim(),
    avatar_url: typeof params.avatarUrl === "string" && params.avatarUrl.trim() ? params.avatarUrl.trim() : null,
  }
}

export function sanitizePublicContribution(contribution: ConsensusContribution): ConsensusContribution {
  const publicAuthorRecord = contribution.public_author as Record<string, unknown> | null | undefined
  return {
    value: contribution.value,
    og_tier: contribution.og_tier,
    weight: contribution.weight,
    created_at: contribution.created_at,
    public_author: buildPublicAuthorSnapshot({
      mode: publicAuthorRecord?.mode ?? null,
      username: publicAuthorRecord?.username ?? null,
      avatarUrl: publicAuthorRecord?.avatar_url ?? null,
    }),
  }
}

export function sanitizePublicConsolidatedCollection(record: ConsolidatedCollection): ConsolidatedCollection {
  const narrative = Object.fromEntries(
    Object.entries(record.narrative).map(([field, value]) => [
      field,
      {
        field: value.field,
        canonical_value: value.canonical_value,
        status: value.status,
        resolved_by_tier: value.resolved_by_tier,
        contributions: value.contributions.map((contribution) => sanitizePublicContribution(contribution)),
      },
    ])
  )

  return {
    collection_slug: record.collection_slug,
    sample_inscription_id: record.sample_inscription_id,
    completeness: record.completeness,
    confidence: record.confidence,
    factual: record.factual,
    narrative,
    sources: record.sources.map((source) => ({
      og_tier: source.og_tier,
      field: source.field,
      created_at: source.created_at,
    })),
    gaps: [...record.gaps],
  }
}
