// wikiCompleteness.ts — Client-side fetch helper for collection completeness map.
// Pillar 2 — Chat Wiki Builder
//
// Fetches the consolidated consensus context for a collection from the Worker.
// Used by the prompt builder to inject missing fields and verified knowledge into Wiki Builder mode.
// Designed to be called once per chat session (not per turn) to avoid latency.

import type { ConsolidatedCollection } from "../types"

export type CanonicalField =
  | "name"
  | "founder"
  | "artist"
  | "inscriber"
  | "launch_date"
  | "launch_context"
  | "origin_narrative"
  | "community_culture"
  | "connections"
  | "current_status"
  | "technical_details"
  | "notable_moments"

export const CANONICAL_FIELDS: CanonicalField[] = [
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
]

export const COLLECTION_ONLY_FIELDS: CanonicalField[] = []
export const INSCRIPTION_ONLY_FIELDS: CanonicalField[] = ["inscriber"]
export const SHARED_FIELDS: CanonicalField[] = CANONICAL_FIELDS.filter(
  (field) => !INSCRIPTION_ONLY_FIELDS.includes(field)
)

export interface CollectionCanonicalFields {
  name: string | null
  founder: string | null
  artist: string | null
  inscriber: string | null
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

export async function fetchConsolidated(collectionSlug: string): Promise<ConsolidatedCollection | null> {
  if (!collectionSlug) return null

  try {
    const slug = encodeURIComponent(collectionSlug)
    const res = await fetch(`/api/wiki/collection/${slug}/consolidated`)
    if (!res.ok) return null

    const data = (await res.json()) as { ok?: boolean, data: ConsolidatedCollection }
    if (!data.ok || !data.data) return null

    return data.data
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

/**
 * Build a structured consolidated context for prompt injection.
 */
export function formatConsolidatedForPrompt(collection: ConsolidatedCollection): string {
  const { completeness, confidence, narrative, gaps } = collection
  
  const knownFacts = Object.values(narrative)
    .filter(f => f.status === "canonical")
    .map(f => `- ${f.field}: ${f.canonical_value} (source: ${f.resolved_by_tier})`)
    .join("\n")

  const disputedFacts = Object.values(narrative)
    .filter(f => f.status === "disputed")
    .map(f => `- ${f.field}: ${f.contributions.map(c => `"${c.value}"`).join(" vs ")} (all from OG contributors)`)
    .join("\n")

  const draftFacts = Object.values(narrative)
    .filter(f => f.status === "draft")
    .map(f => `- ${f.field}: ${f.contributions[0]?.value} (source: ${f.resolved_by_tier}, unverified draft)`)
    .join("\n")

  const missingList = gaps.join(", ")

  return `
Completeness: ${completeness.filled}/${completeness.total} (${Math.round(completeness.score * 100)}%)
Confidence: ${Math.round(confidence * 100)}%

Known facts (community-verified):
${knownFacts || "(None verified yet)"}

${disputedFacts ? `Disputed fields:\n${disputedFacts}\n` : ""}
${draftFacts ? `Draft fields (awaiting OG confirmation):\n${draftFacts}\n` : ""}
Unknown fields (gaps to be filled):
${missingList ? `- ${missingList}` : "(None)"}

Use this consolidated context as enriched background. Use consolidated narrative for cultural and historical context.
`.trim()
}
