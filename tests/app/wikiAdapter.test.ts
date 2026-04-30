import { afterEach, describe, expect, it, vi } from "vitest"
import type { Chronicle } from "../../src/app/lib/types"
import { buildHybridUserMessage, executeWikiTool, generateWikiDraftWithByok } from "../../src/app/lib/byok/wikiAdapter"

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
  events: [
    {
      id: "ev_genesis_1",
      timestamp: "2024-01-01T00:00:00.000Z",
      block_height: 800000,
      event_type: "genesis",
      source: { type: "onchain", ref: "a".repeat(64) },
      description: "Inscribed",
      metadata: {},
    },
  ],
  collector_signals: {
    attention_score: 0,
    sentiment_label: "insufficient_data",
    confidence: "low",
    evidence_count: 0,
    provider_breakdown: { google_trends: 0 },
    scope_breakdown: { inscription_level: 0, collection_level: 0, mixed: 0, dominant_scope: "none" },
    top_evidence: [],
    windows: {
      current_7d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
      context_30d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
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
    protocol: { parents: null, children: null, grandchildren: null, gallery: null, grandparents: null, greatGrandparents: null },
    registry: { match: null, issues: [] },
    market: { match: null },
    profile: null,
    socials: { official_x_profiles: [] },
    presentation: { facets: [] },
  },
  source_catalog: [],
  cached_at: "2024-01-01T00:00:00.000Z",
} satisfies Chronicle

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("wikiAdapter", () => {
  it("decorates user prompt with hybrid policy and wiki status", () => {
    const text = buildHybridUserMessage("Who owns this now?", {
      wikiStatus: "loaded",
      wikiPage: {
        slug: "inscription:abc123i0",
        entity_type: "inscription",
        title: "#7",
        summary: "Test summary",
        sections: [],
        cross_refs: [],
        source_event_ids: ["ev_genesis_1"],
        generated_at: "2026-04-28T00:00:00.000Z",
        byok_provider: "openai",
        unverified_count: 0,
      },
    })

    expect(text).toContain("Hybrid chat policy")
    expect(text).toContain("Wiki context status: loaded")
    expect(text).toContain("#7")
  })

  it("executes wiki tool and parses JSON payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 })))

    const result = await executeWikiTool("search_wiki", { query: "frogs" })
    expect(result.ok).toBe(true)
  })

  it("generates and sanitizes wiki draft using BYOK provider", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              slug: "inscription:abc123i0",
              entity_type: "inscription",
              title: "#7",
              summary: "Factual summary",
              sections: [{ heading: "Overview", body: "Body", source_event_ids: ["ev_genesis_1"] }],
              cross_refs: ["collection:bitcoin-frogs"],
              source_event_ids: ["ev_genesis_1"],
              generated_at: "2026-04-28T00:00:00.000Z",
              byok_provider: "openai",
            }),
          },
        },
      ],
    }), { status: 200 })))

    const draft = await generateWikiDraftWithByok({
      chronicle,
      config: { provider: "openai", model: "gpt-5.4", key: "sk-test" },
      slug: "inscription:abc123i0",
    })

    expect(draft).not.toBeNull()
    expect(draft?.source_event_ids).toContain("ev_genesis_1")
    expect(draft?.sections.length).toBe(1)
  })

  it("falls back to a factual local wiki draft when BYOK request fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "model unavailable" },
    }), { status: 400 })))

    const draft = await generateWikiDraftWithByok({
      chronicle,
      config: { provider: "openai", model: "gpt-5.4", key: "sk-test" },
      slug: "inscription:abc123i0",
    })

    expect(draft).not.toBeNull()
    expect(draft?.byok_provider).toBe("openai:local_factual_fallback")
    expect(draft?.source_event_ids).toEqual(["ev_genesis_1"])
    expect(draft?.sections[0]?.heading).toBe("Overview")
  })

  it("falls back to a factual local wiki draft when BYOK returns non-JSON text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "I cannot produce JSON for this.",
          },
        },
      ],
    }), { status: 200 })))

    const draft = await generateWikiDraftWithByok({
      chronicle,
      config: { provider: "openai", model: "gpt-5.4", key: "sk-test" },
      slug: "inscription:abc123i0",
    })

    expect(draft).not.toBeNull()
    expect(draft?.byok_provider).toBe("openai:local_factual_fallback")
    expect(draft?.summary).toContain("block 800000")
  })
})
