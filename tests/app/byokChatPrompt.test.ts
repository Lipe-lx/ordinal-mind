import { describe, expect, it } from "vitest"
import { buildChatTurnPrompt } from "../../src/app/lib/byok/prompt"
import type { ChatMessage } from "../../src/app/lib/byok/chatTypes"
import type { Chronicle } from "../../src/app/lib/types"

const chronicle = {
  inscription_id: "abc123i0",
  meta: {
    inscription_id: "abc123i0",
    inscription_number: 7,
    sat: 123,
    sat_rarity: "common",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/abc",
    genesis_block: 800000,
    genesis_timestamp: "2024-01-01T00:00:00.000Z",
    genesis_fee: 10,
    owner_address: "bc1powner",
    genesis_txid: "a".repeat(64),
    genesis_vout: 0,
  },
  events: [],
  collector_signals: {
    attention_score: 0,
    sentiment_label: "insufficient_data",
    confidence: "low",
    evidence_count: 0,
    provider_breakdown: { google_trends: 0 },
    scope_breakdown: {
      inscription_level: 0,
      collection_level: 0,
      mixed: 0,
      dominant_scope: "none",
    },
    top_evidence: [],
    windows: {
      current_7d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
      context_30d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
    },
  },
  media_context: {
    kind: "image",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/abc",
    preview_url: "https://ordinals.com/content/abc",
    vision_eligible: true,
    vision_transport: "public_url",
  },
  collection_context: {
    protocol: {
      parents: null,
      children: null,
      gallery: null,
      grandparents: null,
      greatGrandparents: null,
    },
    registry: { match: null, issues: [] },
    market: { match: null },
    profile: null,
    socials: { official_x_profiles: [] },
    presentation: { facets: [] },
  },
  source_catalog: [],
  cached_at: "2024-01-01T00:00:00.000Z",
} satisfies Chronicle

describe("buildChatTurnPrompt", () => {
  it("includes conversation history and latest user message", () => {
    const history: ChatMessage[] = [
      { id: "u1", role: "user", content: "What is the provenance?", createdAt: "2024-01-01T00:00:00.000Z", turnId: "t1" },
      { id: "a1", role: "assistant", content: "One genesis and no transfer yet.", createdAt: "2024-01-01T00:00:01.000Z", turnId: "t1" },
    ]

    const prompt = buildChatTurnPrompt(chronicle, history, "Any uncertainty?", {
      mode: "qa",
      intent: "chronicle_query",
    })

    expect(prompt).toContain("Conversation so far")
    expect(prompt).toContain("User: What is the provenance?")
    expect(prompt).toContain("Assistant: One genesis and no transfer yet.")
    expect(prompt).toContain("Latest user message")
    expect(prompt).toContain("Any uncertainty?")
    expect(prompt).toContain("Answer in the same language as the latest user message.")
    expect(prompt).toContain("between these exact tags: <final_answer> and </final_answer>")
    expect(prompt).toContain("Do not copy placeholder text")
    expect(prompt).toContain("Do not include internal reasoning")
  })

  it("instructs follow-up corrections to use parent context without guessing", () => {
    const history: ChatMessage[] = [
      { id: "u1", role: "user", content: "Quando ela foi mintada?", createdAt: "2024-01-01T00:00:00.000Z", turnId: "t1" },
      { id: "a1", role: "assistant", content: "A inscrição raiz foi mintada em 2024.", createdAt: "2024-01-01T00:00:01.000Z", turnId: "t1" },
    ]

    const prompt = buildChatTurnPrompt(chronicle, history, "falo da parent", {
      mode: "qa",
      intent: "chronicle_query",
    })

    expect(prompt).toContain("reinterpret the previous factual question")
    expect(prompt).toContain("If the parent mint date is not present")
    expect(prompt).toContain("falo da parent")
  })
})
