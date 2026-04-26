import type { SocialMatchType, SocialScope } from "../../../app/lib/types"

export interface MentionQuerySpec {
  text: string
  matchType: SocialMatchType
  scope: SocialScope
  limit: number
  matchWeight: number
}

export interface MentionQueryInput {
  inscriptionId: string
  inscriptionNumber?: number
  collectionName?: string
  itemName?: string
  fullLabel?: string
}

export function buildMentionQueries(input: MentionQueryInput): MentionQuerySpec[] {
  const collectionName = normalizeQueryText(input.collectionName)
  const itemName = normalizeQueryText(input.itemName)
  const fullLabel = normalizeQueryText(input.fullLabel)
  const inscriptionId = normalizeQueryText(input.inscriptionId)
  const inscriptionNumber = Number.isFinite(input.inscriptionNumber)
    ? input.inscriptionNumber
    : undefined

  const candidates: Array<MentionQuerySpec | null> = [
    collectionName
      ? {
          text: quotePhrase(collectionName),
          matchType: "collection_only",
          scope: "collection_level",
          limit: 8,
          matchWeight: 1.0,
        }
      : null,
    fullLabel
      ? {
          text: quotePhrase(fullLabel),
          matchType: "item_plus_collection",
          scope: "mixed",
          limit: 5,
          matchWeight: 0.95,
        }
      : itemName && collectionName
        ? {
            text: `${quotePhrase(itemName)} ${quotePhrase(collectionName)}`,
            matchType: "item_plus_collection",
            scope: "mixed",
            limit: 5,
            matchWeight: 0.95,
          }
        : null,
    itemName
      ? {
          text: quotePhrase(itemName),
          matchType: "item_only",
          scope: "inscription_level",
          limit: 3,
          matchWeight: 0.55,
        }
      : null,
    inscriptionNumber != null
      ? {
          text: `"inscription ${inscriptionNumber}"`,
          matchType: "inscription_number",
          scope: "inscription_level",
          limit: 2,
          matchWeight: 0.5,
        }
      : null,
    inscriptionId
      ? {
          text: quotePhrase(inscriptionId),
          matchType: "inscription_id",
          scope: "inscription_level",
          limit: 2,
          matchWeight: 0.7,
        }
      : null,
  ]

  return dedupeQueries(candidates.filter((candidate): candidate is MentionQuerySpec => Boolean(candidate)))
}

function dedupeQueries(queries: MentionQuerySpec[]): MentionQuerySpec[] {
  const seen = new Set<string>()
  return queries.filter((query) => {
    const key = `${query.matchType}:${query.text.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeQueryText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 1 ? normalized : undefined
}

function quotePhrase(value: string): string {
  return `"${value.replace(/^"+|"+$/g, "")}"`
}
