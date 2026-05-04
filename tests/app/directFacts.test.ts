import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveDirectFactAnswer } from "../../src/app/lib/byok/directFacts"
import type { Chronicle } from "../../src/app/lib/types"

const baseChronicle: Chronicle = {
  inscription_id: "rooti0",
  meta: {
    inscription_id: "rooti0",
    inscription_number: 7,
    sat: 123456,
    sat_rarity: "rare",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/rooti0",
    genesis_block: 840000,
    genesis_timestamp: "2024-04-20T00:00:00.000Z",
    genesis_fee: 1200,
    owner_address: "bc1ptestowner",
    genesis_txid: "root",
    genesis_vout: 0,
    collection: {
      parent_inscription_id: "parent1i0",
      name: "Runestone",
    },
  },
  events: [
    {
      id: "ev1",
      timestamp: "2024-04-20T00:00:00.000Z",
      block_height: 840000,
      event_type: "genesis",
      source: { type: "onchain", ref: "root" },
      description: "Inscribed at block 840000",
      metadata: {},
    },
    {
      id: "ev2",
      timestamp: "2024-05-01T00:00:00.000Z",
      block_height: 841000,
      event_type: "transfer",
      source: { type: "onchain", ref: "tx1" },
      description: "Transferred",
      metadata: {},
    },
  ],
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
    content_url: "https://ordinals.com/content/rooti0",
    preview_url: "https://ordinals.com/preview/rooti0",
    vision_eligible: true,
    vision_transport: "public_url",
  },
  collection_context: {
    protocol: {
      parents: null,
      children: null,
      grandchildren: null,
      gallery: null,
      grandparents: null,
      greatGrandparents: null,
    },
    registry: {
      match: {
        matched_collection: "Runestone",
        match_type: "parent",
        slug: "runestone",
        registry_ids: ["parent1i0"],
        quality_state: "verified",
        issues: [],
        source_ref: "https://example.com/registry",
      },
      issues: [],
    },
    market: {
      match: {
        collection_slug: "runestone",
        collection_name: "Runestone",
        collection_href: "/collection/runestone",
        verified: true,
        source_ref: "https://ord.net/collection/runestone",
      },
      satflow_match: null,
      ord_net_match: null,
      preferred_description: null,
      satflow_description: null,
      ord_net_description: null,
    },
    profile: {
      name: "Runestone",
      slug: "runestone",
      summary: "Runestone profile",
      creators: [],
      milestones: [],
      collector_signals: [],
      market_stats: {
        source_ref: "https://www.satflow.com/ordinals/runestone",
        supply: "112.4K",
      },
      sources: [],
    },
    socials: { official_x_profiles: [] },
    presentation: {
      primary_label: "Runestone",
      full_label: "Runestone",
      facets: [],
    },
  },
  source_catalog: [],
  cached_at: "2026-04-25T00:00:00.000Z",
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("resolveDirectFactAnswer", () => {
  it("answers collection size from the cache-backed wiki tool", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      source: "wiki_db",
      collection_slug: "runestone",
      collection_size: 112383,
      collection_size_source: "raw_chronicle_events.genesis",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })))

    const result = await resolveDirectFactAnswer({
      prompt: "Quantas inscrições existem nessa coleção?",
      chronicle: baseChronicle,
    })

    expect(result.handled).toBe(true)
    expect(result.reason).toBe("collection_size_from_wiki_tool")
    expect(result.envelope?.answer).toContain("112.383")
    expect(result.envelope?.used_tools).toEqual(["get_collection_context"])
  })

  it("falls back to public collection supply when exact count is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: "wiki_db_unavailable",
      partial: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })))

    const result = await resolveDirectFactAnswer({
      prompt: "How many inscriptions are in this collection?",
      chronicle: baseChronicle,
    })

    expect(result.handled).toBe(true)
    expect(result.reason).toBe("collection_supply_from_market_profile")
    expect(result.envelope?.answer).toContain("112.4K")
    expect(result.envelope?.uncertainty).toContain("public collection-page supply")
  })

  it("does not intercept general runestone questions", async () => {
    const result = await resolveDirectFactAnswer({
      prompt: "Olá, quantas runestone existem?",
      chronicle: {
        ...baseChronicle,
        collection_context: {
          ...baseChronicle.collection_context,
          registry: { match: null, issues: [] },
          market: {
            match: null,
            satflow_match: null,
            ord_net_match: null,
            preferred_description: null,
            satflow_description: null,
            ord_net_description: null,
          },
          profile: null,
          presentation: { primary_label: null, full_label: null, facets: [] },
        },
      },
    })

    expect(result.handled).toBe(false)
  })

  it("answers in Spanish for direct factual prompts in Spanish", async () => {
    const result = await resolveDirectFactAnswer({
      prompt: "¿Quién es el owner actual de esta inscripción?",
      chronicle: baseChronicle,
    })

    expect(result.handled).toBe(true)
    expect(result.reason).toBe("current_owner_from_chronicle")
    expect(result.envelope?.answer).toContain("El owner actual")
    expect(result.envelope?.evidence).toContain("esta inscripción")
  })
})
