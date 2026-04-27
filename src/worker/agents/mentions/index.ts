import type {
  CollectorSignalConfidence,
  CollectorSignals,
  CollectorSignalsWindow,
  SentimentLabel,
  SocialMention,
  SocialScope,
  SocialSignalProvider,
  SourceCatalogItem,
} from "../../../app/lib/types"
import { buildMentionQueries } from "./queryBuilder"
import type { MentionSearchInput, MentionCollectionResult } from "./types"
import { createProviderDebug } from "./types"
import { fetchGoogleTrendsMacro } from "./trends"

const PROVIDER_WEIGHTS: Record<SocialSignalProvider, number> = {
  google_trends: 0,
}

const POSITIVE_WORDS = [
  "amazing", "best", "bullish", "clean", "epic", "fire", "gem", "good", "great",
  "historic", "iconic", "insane", "legendary", "love", "rare", "strong",
]

const NEGATIVE_WORDS = [
  "bad", "bearish", "dead", "dump", "fake", "hate", "overpriced", "rug", "scam",
  "trash", "ugly", "weak", "worthless",
]

export async function collectSignals(input: MentionSearchInput): Promise<MentionCollectionResult> {
  const queries = buildMentionQueries(input)

  const providerDebug = {
    google_trends: createProviderDebug("google_trends", input, queries),
  } satisfies Record<SocialSignalProvider, ReturnType<typeof createProviderDebug>>

  const baseContext = {
    ...input,
    queries,
  }

  const [trendsResult] = await Promise.all([
    fetchGoogleTrendsMacro({ ...baseContext, diagnostics: providerDebug.google_trends }),
  ])

  const mentions = dedupeMentions([])
  const collectorSignals = buildCollectorSignals(mentions)
  const sourceCatalog = mergeSourceCatalog([
    ...trendsResult.sourceCatalog,
  ])

  return {
    mentions,
    collectorSignals,
    sourceCatalog,
    debugInfo: input.debug
      ? {
          mention_providers: providerDebug,
        }
      : undefined,
  }
}

export function buildCollectorSignals(mentions: SocialMention[]): CollectorSignals {
  const mentions7d = withinDays(mentions, 7)
  const mentions30d = withinDays(mentions, 30)

  return {
    attention_score: calculateAttentionScore(mentions7d),
    sentiment_label: calculateSentiment(mentions7d),
    confidence: calculateConfidence(mentions7d),
    evidence_count: mentions.length,
    provider_breakdown: countProviders(mentions),
    scope_breakdown: countScopes(mentions),
    top_evidence: rankMentions(mentions7d).slice(0, 5).map((mention) => ({
      platform: mention.platform,
      provider: mention.provider,
      url: mention.canonical_url,
      title: mention.title,
      excerpt: mention.excerpt,
      author_handle: mention.author_handle,
      published_at: mention.published_at,
      scope: mention.scope,
      match_type: mention.match_type,
    })),
    windows: {
      current_7d: buildWindow(mentions7d),
      context_30d: buildWindow(mentions30d),
    },
  }
}

function buildWindow(mentions: SocialMention[]): CollectorSignalsWindow {
  return {
    evidence_count: mentions.length,
    provider_count: distinctProviders(mentions).size,
    attention_score: calculateAttentionScore(mentions),
    sentiment_label: calculateSentiment(mentions),
  }
}

function calculateAttentionScore(mentions: SocialMention[]): number {
  if (mentions.length === 0) return 0
  const weightedVolume = mentions.reduce((sum, mention) => sum + mentionScore(mention), 0)
  const diversityBonus = distinctProviders(mentions).size * 8
  const recencyBonus = mentions.reduce((sum, mention) => sum + recencyWeight(mention), 0) * 4
  return Math.min(100, Math.round(weightedVolume * 10 + diversityBonus + recencyBonus))
}

function calculateSentiment(mentions: SocialMention[]): SentimentLabel {
  if (mentions.length < 5 || distinctProviders(mentions).size < 2) {
    return "insufficient_data"
  }

  const scored = mentions.map((mention) => lexicalSentiment(mention.text) * mentionScore(mention))
  const positiveCount = scored.filter((score) => score > 0.25).length
  const negativeCount = scored.filter((score) => score < -0.25).length
  const average = scored.reduce((sum, score) => sum + score, 0) / Math.max(scored.length, 1)

  if (positiveCount > 0 && negativeCount > 0 && Math.min(positiveCount, negativeCount) / mentions.length >= 0.25) {
    return "mixed"
  }
  if (average > 0.3) return "positive"
  if (average < -0.3) return "negative"
  return "neutral"
}

function calculateConfidence(mentions: SocialMention[]): CollectorSignalConfidence {
  if (mentions.length === 0) return "low"
  const providers = distinctProviders(mentions).size
  const itemWeighted = mentions.filter((mention) => mention.scope !== "collection_level").length
  const collectionRatio = mentions.filter((mention) => mention.scope === "collection_level").length / mentions.length

  if (providers >= 3 && itemWeighted >= 3 && collectionRatio < 0.5) return "high"
  if (providers >= 2 && itemWeighted >= 1 && collectionRatio < 0.85) return "medium"
  return "low"
}

function countProviders(mentions: SocialMention[]): Record<SocialSignalProvider, number> {
  const counts: Record<SocialSignalProvider, number> = {
    google_trends: 0,
  }
  for (const mention of mentions) {
    counts[mention.provider] += 1
  }
  return counts
}

function countScopes(mentions: SocialMention[]): CollectorSignals["scope_breakdown"] {
  const counts = {
    inscription_level: 0,
    collection_level: 0,
    mixed: 0,
  } satisfies Record<SocialScope, number>

  for (const mention of mentions) {
    counts[mention.scope] += 1
  }

  const dominantScope = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none") as SocialScope | "none"
  return { ...counts, dominant_scope: mentions.length > 0 ? dominantScope : "none" }
}

function withinDays(mentions: SocialMention[], days: number): SocialMention[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return mentions.filter((mention) => new Date(mention.published_at).getTime() >= cutoff)
}

function rankMentions(mentions: SocialMention[]): SocialMention[] {
  return [...mentions].sort((a, b) => mentionScore(b) - mentionScore(a))
}

function mentionScore(mention: SocialMention): number {
  return PROVIDER_WEIGHTS[mention.provider] * mention.provider_confidence + recencyWeight(mention)
}

function recencyWeight(mention: SocialMention): number {
  const ageMs = Math.max(0, Date.now() - new Date(mention.published_at).getTime())
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  if (ageDays <= 2) return 1
  if (ageDays <= 7) return 0.75
  if (ageDays <= 30) return 0.4
  return 0.15
}

function lexicalSentiment(text: string): number {
  const normalized = text.toLowerCase()
  const positive = POSITIVE_WORDS.reduce((sum, word) => sum + Number(normalized.includes(word)), 0)
  const negative = NEGATIVE_WORDS.reduce((sum, word) => sum + Number(normalized.includes(word)), 0)
  if (positive === 0 && negative === 0) return 0
  return (positive - negative) / Math.max(positive + negative, 1)
}

function distinctProviders(mentions: SocialMention[]): Set<SocialSignalProvider> {
  return new Set(mentions.map((mention) => mention.provider))
}

function dedupeMentions(mentions: SocialMention[]): SocialMention[] {
  const seen = new Set<string>()
  return mentions.filter((mention) => {
    const key = `${mention.provider}:${mention.canonical_url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeSourceCatalog(sourceCatalog: SourceCatalogItem[]): SourceCatalogItem[] {
  const seen = new Set<string>()
  return sourceCatalog.filter((entry) => {
    const key = `${entry.source_type}:${entry.url_or_ref}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
