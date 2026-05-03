// wikiCompleteness.ts — Client-side fetch helper for collection completeness map.
// Pillar 2 — Chat Wiki Builder
//
// Fetches the canonical field completeness for a collection from the Worker.
// Used by the prompt builder to inject missing fields into Wiki Builder mode.
// Designed to be called once per chat session (not per turn) to avoid latency.

export type CanonicalField =
  | "founder"
  | "launch_date"
  | "launch_context"
  | "origin_narrative"
  | "technical_details"
  | "notable_moments"
  | "community_culture"
  | "connections"
  | "current_status"

export const CANONICAL_FIELDS: CanonicalField[] = [
  "founder",
  "launch_date",
  "launch_context",
  "origin_narrative",
  "technical_details",
  "notable_moments",
  "community_culture",
  "connections",
  "current_status",
]

export interface CollectionCanonicalFields {
  founder: string | null
  launch_date: string | null
  launch_context: string | null
  origin_narrative: string | null
  technical_details: string | null
  notable_moments: string | null
  community_culture: string | null
  connections: string | null
  current_status: string | null
}

export interface CompletenessMap {
  collection_slug: string
  filled: number
  total: number
  score: number
  missing_fields: CanonicalField[]
  fields: CollectionCanonicalFields
}

/**
 * Fetch the completeness map for a collection from the Worker.
 * Returns null if the fetch fails, the slug is unknown, or the DB is unavailable.
 * Always fails gracefully — callers should treat null as "no completeness data".
 */
export async function fetchCompleteness(collectionSlug: string): Promise<CompletenessMap | null> {
  if (!collectionSlug) return null

  try {
    const slug = encodeURIComponent(collectionSlug)
    const res = await fetch(`/api/wiki/collection/${slug}/completeness`)
    if (!res.ok) return null

    const data = (await res.json()) as { ok?: boolean } & Partial<CompletenessMap>
    if (!data.ok) return null

    // Validate shape minimally before returning
    if (
      typeof data.filled !== "number" ||
      typeof data.total !== "number" ||
      !Array.isArray(data.missing_fields)
    ) {
      return null
    }

    return {
      collection_slug: data.collection_slug ?? collectionSlug,
      filled: data.filled,
      total: data.total,
      score: data.score ?? 0,
      missing_fields: data.missing_fields as CanonicalField[],
      fields: (data.fields ?? {}) as CollectionCanonicalFields,
    }
  } catch {
    return null
  }
}

/**
 * Build a compact summary of missing fields for prompt injection.
 * Example: "founder, launch_date, origin_narrative (6/9 filled)"
 */
export function formatCompletenessForPrompt(completeness: CompletenessMap): string {
  const { filled, total, missing_fields } = completeness
  if (missing_fields.length === 0) {
    return `All ${total} fields are filled (completeness: 100%).`
  }
  const missingList = missing_fields.join(", ")
  return `${filled}/${total} fields filled. Missing: ${missingList}.`
}
