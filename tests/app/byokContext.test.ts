import { afterEach, describe, expect, it, vi } from "vitest"
import type { Chronicle } from "../../src/app/lib/types"
import { buildSynthesisContext } from "../../src/app/lib/byok/prompt"
import { getVisionFallbackReason, prepareSynthesisInput } from "../../src/app/lib/byok/context"

const chronicle: Chronicle = {
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
    owner_address: "bc1ptest",
    genesis_txid: "root",
    genesis_vout: 0,
    collection: {
      parent_inscription_id: "parent1i0",
      name: "Quantum Cats",
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
      parents: {
        items: [
          {
            inscription_id: "parent1i0",
            inscription_number: 101,
            content_type: "image/png",
            content_url: "https://ordinals.com/content/parent1i0",
          },
        ],
        total_count: 1,
        more: false,
        source_ref: "https://ordinals.com/r/parents/rooti0/inscriptions",
        partial: false,
      },
      children: {
        items: [
          {
            inscription_id: "child1i0",
            inscription_number: 202,
            content_type: "image/png",
            content_url: "https://ordinals.com/content/child1i0",
          },
        ],
        total_count: 1,
        more: false,
        source_ref: "https://ordinals.com/r/children/rooti0/inscriptions",
        partial: false,
      },
      gallery: {
        gallery_id: "rooti0",
        items: [
          {
            inscription_id: "gallery-item1i0",
            inscription_number: 303,
            content_type: "image/png",
            content_url: "https://ordinals.com/content/gallery-item1i0",
          },
        ],
        total_count: 1,
        more: false,
        source_ref: "https://ordinals.com/gallery/rooti0",
        partial: false,
      },
    },
    registry: {
      match: {
        matched_collection: "Quantum Cats",
        match_type: "parent",
        slug: "quantum_cats",
        registry_ids: ["parent1i0"],
        quality_state: "verified",
        issues: [],
        source_ref: "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections.json",
      },
      issues: [],
    },
    market: {
      match: {
        collection_slug: "quantum_cats",
        collection_name: "Quantum Cats",
        collection_href: "/collection/quantum_cats",
        item_name: "Quantum Cat #7",
        verified: true,
        owner_address: "bc1ptest",
        source_ref: "https://ord.net/inscription/rooti0",
      },
    },
    profile: {
      name: "Quantum Cats",
      slug: "quantum_cats",
      summary: "Quantum Cats is a collection profile used by this test.",
      creators: [
        {
          label: "Creator",
          value: "Taproot Wizards",
          source_ref: "https://example.com/quantum-cats",
        },
      ],
      milestones: [
        {
          label: "Collection match",
          value: "Matched through public collection context.",
          source_ref: "https://example.com/quantum-cats",
        },
      ],
      collector_signals: [
        {
          label: "Provenance",
          value: "Has an on-chain parent relation.",
          source_ref: "https://ordinals.com/r/parents/rooti0/inscriptions",
        },
      ],
      market_stats: {
        source_ref: "https://www.satflow.com/ordinals/quantum-cats",
        supply: "3.3K",
        listed: "100",
      },
      sources: [],
    },
    socials: {
      official_x_profiles: [
        {
          url: "https://x.com/quantumcats",
          source_ref: "https://www.satflow.com/ordinals/quantum-cats",
        },
      ],
    },
    presentation: {
      primary_label: "Quantum Cats",
      facets: [
        {
          label: "Verified Collection",
          value: "Quantum Cats",
          tone: "curated",
        },
      ],
    },
  },
  source_catalog: [
    {
      source_type: "protocol_inscription",
      url_or_ref: "https://ordinals.com/inscription/rooti0",
      trust_level: "official_index",
      fetched_at: "2026-04-25T00:00:00.000Z",
      partial: false,
    },
  ],
  cached_at: "2026-04-25T00:00:00.000Z",
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("buildSynthesisContext", () => {
  it("includes protocol, registry, and source sections", () => {
    const context = buildSynthesisContext(chronicle)

    expect(context).toContain("Identity:")
    expect(context).toContain("Gallery sample:")
    expect(context).toContain("Collector focus:")
    expect(context).toContain("Collection profile:")
    expect(context).toContain("Curated collection match:")
    expect(context).toContain("Market overlay:")
    expect(context).toContain("Official X accounts: https://x.com/quantumcats")
    expect(context).toContain("Quantum Cats")
    expect(context).toContain("Primary lens")
    expect(context).toContain("protocol_inscription")
  })
})

describe("prepareSynthesisInput", () => {
  it("uses image + context when the provider supports public URLs", async () => {
    const prepared = await prepareSynthesisInput(chronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "responses",
    })

    expect(prepared.inputMode).toBe("image+context")
    expect(prepared.image).toMatchObject({
      transport: "public_url",
      url: "https://ordinals.com/content/rooti0",
    })
  })

  it("falls back to text-only for non-vision content", async () => {
    const prepared = await prepareSynthesisInput(
      {
        ...chronicle,
        media_context: {
          kind: "svg",
          content_type: "image/svg+xml",
          content_url: "https://ordinals.com/content/rooti0",
          preview_url: "https://ordinals.com/preview/rooti0",
          vision_eligible: false,
          vision_transport: "unsupported",
          fallback_reason:
            "SVG inscriptions render through ordinals preview and stay text-only for synthesis.",
        },
      },
      {
        supportsVisionInput: true,
        supportsToolCalling: true,
        imageTransport: "public_url",
        preferredApi: "responses",
      }
    )

    expect(prepared.inputMode).toBe("text-only")
    expect(prepared.fallbackReason).toContain("SVG")
  })

  it("prepares inline image data for Gemini-style providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Blob(["png-binary"], { type: "image/png" }), { status: 200 })
      )
    )

    const prepared = await prepareSynthesisInput(chronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "inline_data",
      preferredApi: "generateContent",
    })

    expect(prepared.inputMode).toBe("image+context")
    expect(prepared.image?.transport).toBe("inline_data")
    expect(prepared.image?.mimeType).toBe("image/png")
    expect(prepared.image?.data).toBeTruthy()
  })

  it("falls back to text-only when inline image loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    const prepared = await prepareSynthesisInput(chronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "inline_data",
      preferredApi: "generateContent",
    })

    expect(prepared.inputMode).toBe("text-only")
    expect(prepared.fallbackReason).toContain("could not be loaded inline")
  })
})

describe("getVisionFallbackReason", () => {
  it("flags providers that do not support vision", () => {
    const reason = getVisionFallbackReason(chronicle, {
      supportsVisionInput: false,
      supportsToolCalling: false,
      imageTransport: "unsupported",
      preferredApi: "chat_completions",
    })

    expect(reason).toContain("text-only")
  })
})
