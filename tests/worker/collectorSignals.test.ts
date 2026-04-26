import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SocialMention } from "../../src/app/lib/types"
import { buildCollectorSignals } from "../../src/worker/agents/mentions"

function makeMention(overrides: Partial<SocialMention>): SocialMention {
  return {
    platform: "nostr",
    provider: "nostr",
    canonical_url: `https://njump.me/${Math.random().toString(36).slice(2)}`,
    title: "Legendary collection momentum",
    excerpt: "Amazing, iconic, bullish energy around the collection.",
    text: "Legendary collection momentum. Amazing, iconic, bullish energy around the collection.",
    published_at: "2026-04-24T00:00:00.000Z",
    discovered_at: "2026-04-24T00:01:00.000Z",
    scope: "collection_level",
    match_type: "collection_only",
    provider_confidence: 1,
    ...overrides,
  }
}

describe("buildCollectorSignals", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-26T00:00:00.000Z"))
  })

  it("computes positive cross-provider sentiment only when thresholds are met", () => {
    const mentions: SocialMention[] = [
      makeMention({ provider: "nostr", platform: "nostr", canonical_url: "https://njump.me/1" }),
      makeMention({ provider: "nostr", platform: "nostr", canonical_url: "https://njump.me/2", scope: "mixed", match_type: "item_plus_collection", provider_confidence: 0.95 }),
      makeMention({ provider: "nostr", platform: "nostr", canonical_url: "https://njump.me/3", scope: "inscription_level", match_type: "item_only", provider_confidence: 0.55 }),
      makeMention({ provider: "bluesky", platform: "bluesky", canonical_url: "https://bsky.app/profile/a/post/1", scope: "mixed", match_type: "item_plus_collection", provider_confidence: 0.95 }),
      makeMention({ provider: "bluesky", platform: "bluesky", canonical_url: "https://bsky.app/profile/a/post/2", scope: "collection_level", match_type: "collection_only" }),
    ]

    const signals = buildCollectorSignals(mentions)
    expect(signals.sentiment_label).toBe("positive")
    expect(signals.confidence).toBe("medium")
    expect(signals.provider_breakdown.nostr).toBe(3)
    expect(signals.provider_breakdown.bluesky).toBe(2)
    expect(signals.scope_breakdown.mixed).toBeGreaterThan(0)
    expect(signals.attention_score).toBeGreaterThan(0)
  })

  it("returns insufficient_data below the cross-source threshold", () => {
    const mentions: SocialMention[] = [
      makeMention({ canonical_url: "https://njump.me/a" }),
      makeMention({ canonical_url: "https://njump.me/b" }),
      makeMention({ canonical_url: "https://njump.me/c" }),
      makeMention({ canonical_url: "https://njump.me/d" }),
    ]

    const signals = buildCollectorSignals(mentions)
    expect(signals.sentiment_label).toBe("insufficient_data")
    expect(signals.confidence).toBe("low")
  })
})
