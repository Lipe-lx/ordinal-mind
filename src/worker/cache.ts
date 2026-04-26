// KV cache layer with TTL strategy.
// Immutable genesis data → 30-day TTL
// Recent inscriptions (< 7 days old) → 1-hour TTL

import type {
  Chronicle,
  ChronicleEvent,
  LegacyXMentionDebugInfo,
  SocialMention,
} from "../app/lib/types"
import { buildCollectorSignals } from "./agents/mentions"

const TTL = {
  default: 60 * 60 * 24 * 30, // 30 days — immutable on-chain data
  recent: 60 * 60,            // 1 hour — for inscriptions < 7 days old
} as const

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function cacheGet(kv: KVNamespace, id: string): Promise<Chronicle | null> {
  const raw = await kv.get(id)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Chronicle & {
      debug_info?: {
        x_mentions?: LegacyXMentionDebugInfo
      }
    }
    return migrateChronicle(parsed)
  } catch {
    return null
  }
}

export async function cachePut(kv: KVNamespace, id: string, chronicle: Chronicle): Promise<void> {
  const genesisTs = new Date(chronicle.meta.genesis_timestamp).getTime()
  const isRecent = Date.now() - genesisTs < SEVEN_DAYS_MS
  const ttl = isRecent ? TTL.recent : TTL.default

  await kv.put(id, JSON.stringify(chronicle), { expirationTtl: ttl })
}

function migrateChronicle(
  chronicle: Chronicle & {
    debug_info?: {
      x_mentions?: LegacyXMentionDebugInfo
    }
  }
): Chronicle {
  const events = chronicle.events.map(migrateEvent)
  const collectorSignals = chronicle.collector_signals
    ?? buildCollectorSignals(events.flatMap(eventToSocialMention))
  const mentionProviders = chronicle.debug_info?.mention_providers
    ?? (chronicle.debug_info?.x_mentions
      ? {
          x_fallback: {
            provider: "x_fallback" as const,
            collection_name: chronicle.debug_info.x_mentions.collection_name,
            item_name: chronicle.debug_info.x_mentions.item_name,
            official_x_urls: chronicle.debug_info.x_mentions.official_x_urls,
            candidate_handles: chronicle.debug_info.x_mentions.candidate_handles,
            queries: chronicle.debug_info.x_mentions.queries,
            attempts: chronicle.debug_info.x_mentions.attempts.map((attempt) => ({
              query: attempt.query,
              outcome: attempt.outcome,
              status: attempt.status,
              result_count: attempt.mention_count,
            })),
            notes: ["Migrated from legacy x_mentions debug info."],
          },
        }
      : undefined)

  return {
    ...chronicle,
    events,
    collector_signals: collectorSignals,
    debug_info: mentionProviders ? { mention_providers: mentionProviders } : chronicle.debug_info,
  }
}

function migrateEvent(event: ChronicleEvent): ChronicleEvent {
  if ((event.event_type as string) !== "x_mention") return event

  return {
    ...event,
    event_type: "social_mention",
    metadata: {
      platform: "x",
      scope: "collection_level",
      match_type: "collection_only",
      canonical_url: event.source.ref,
      excerpt: typeof event.metadata?.snippet === "string" ? event.metadata.snippet : "",
      published_at: event.timestamp,
      discovered_at: event.timestamp,
      provider_confidence: 0.35,
      ...event.metadata,
    },
  } as ChronicleEvent
}

function eventToSocialMention(event: ChronicleEvent): SocialMention[] {
  if (event.event_type !== "social_mention") return []

  return [{
    platform: (event.metadata.platform as SocialMention["platform"] | undefined) ?? "x",
    provider: "x_fallback",
    canonical_url: (event.metadata.canonical_url as string | undefined) ?? event.source.ref,
    title: event.description,
    excerpt: (event.metadata.excerpt as string | undefined) ?? "",
    text: [event.description, typeof event.metadata.excerpt === "string" ? event.metadata.excerpt : ""]
      .filter(Boolean)
      .join(" · "),
    author_handle: typeof event.metadata.author_handle === "string" ? event.metadata.author_handle : undefined,
    author_url: typeof event.metadata.author_url === "string" ? event.metadata.author_url : undefined,
    published_at: (event.metadata.published_at as string | undefined) ?? event.timestamp,
    discovered_at: (event.metadata.discovered_at as string | undefined) ?? event.timestamp,
    scope: (event.metadata.scope as SocialMention["scope"] | undefined) ?? "collection_level",
    match_type: (event.metadata.match_type as SocialMention["match_type"] | undefined) ?? "collection_only",
    provider_confidence: typeof event.metadata.provider_confidence === "number"
      ? event.metadata.provider_confidence
      : 0.35,
    engagement: event.metadata.engagement as SocialMention["engagement"] | undefined,
  }]
}
