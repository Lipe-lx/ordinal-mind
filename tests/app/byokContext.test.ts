import { afterEach, describe, expect, it, vi } from "vitest"
import type { Chronicle } from "../../src/app/lib/types"
import { buildSynthesisContext } from "../../src/app/lib/byok/prompt"
import {
  getVisionFallbackReason,
  prepareSynthesisInput,
  resetPreparedContentCacheForTests,
  shouldAttachContentForChat,
} from "../../src/app/lib/byok/context"
import type { ChatMessage } from "../../src/app/lib/byok/chatTypes"

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
      grandchildren: null,
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
      grandparents: null,
      greatGrandparents: null,
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
      satflow_match: null,
      ord_net_match: null,
      preferred_description: {
        source: "satflow",
        source_ref: "https://www.satflow.com/ordinal/rooti0",
        text: "Quantum Cats is a test collection description from Satflow.",
        target: "inscription_page",
      },
      satflow_description: {
        source: "satflow",
        source_ref: "https://www.satflow.com/ordinal/rooti0",
        text: "Quantum Cats is a test collection description from Satflow.",
        target: "inscription_page",
      },
      ord_net_description: {
        source: "ord_net",
        source_ref: "https://ord.net/inscription/101",
        text: "Quantum Cats is a parent description from ord.net.",
        target: "parent_inscription_page",
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
  resetPreparedContentCacheForTests()
})

describe("buildSynthesisContext", () => {
  it("includes protocol, registry, and source sections", () => {
    const context = buildSynthesisContext(chronicle)

    expect(context).toContain("Identity:")
    expect(context).toContain("Gallery sample:")
    expect(context).toContain("Collector focus:")
    expect(context).toContain("Trusted collection descriptions:")
    expect(context).toContain("Collection profile:")
    expect(context).toContain("Curated collection match:")
    expect(context).toContain("Market overlay:")
    expect(context).toContain("Preferred source: Satflow inscription page (https://www.satflow.com/ordinal/rooti0)")
    expect(context).toContain("Alternate source: ord.net parent inscription page (https://ord.net/inscription/101)")
    expect(context).toContain("Official X accounts: https://x.com/quantumcats")
    expect(context).toContain("Quantum Cats")
    expect(context).toContain("Primary lens")
    expect(context).toContain("protocol_inscription")
  })
})

describe("prepareSynthesisInput", () => {
  it("uses attachments + context when the provider supports public image URLs", async () => {
    const prepared = await prepareSynthesisInput(chronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "responses",
    })

    expect(prepared.inputMode).toBe("attachments+context")
    expect(prepared.attachments[0]).toMatchObject({
      kind: "image",
      transport: "public_url",
      url: "https://ordinals.com/content/rooti0",
    })
    expect(prepared.contentDigest).toContain("Primary inscription media attached directly")
  })

  it("attaches inline text for SVG inscriptions and records a digest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<svg><text>Quantum Cat</text></svg>", {
          status: 200,
          headers: { "Content-Type": "image/svg+xml" },
        })
      )
    )

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

    expect(prepared.inputMode).toBe("attachments+context")
    expect(prepared.attachments[0]).toMatchObject({
      kind: "text",
      transport: "inline_text",
      mimeType: "image/svg+xml",
    })
    expect(prepared.attachments[0].text).toContain("Quantum Cat")
    expect(prepared.contentDigest).toContain("inline text")
  })

  it("reuses the local content cache for repeated text-like inscriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"name":"Quantum Cat","palette":["gold","black"]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const textChronicle = {
      ...chronicle,
      media_context: {
        kind: "text" as const,
        content_type: "application/json",
        content_url: "https://ordinals.com/content/rooti0",
        preview_url: "https://ordinals.com/content/rooti0",
        vision_eligible: false,
        vision_transport: "unsupported" as const,
      },
    }

    const first = await prepareSynthesisInput(textChronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "responses",
    })
    const second = await prepareSynthesisInput(textChronicle, {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "responses",
    })

    expect(first.inputMode).toBe("attachments+context")
    expect(second.inputMode).toBe("attachments+context")
    expect(first.attachments[0].text).toContain("Quantum Cat")
    expect(second.attachments[0].text).toContain("Quantum Cat")
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

    expect(prepared.inputMode).toBe("attachments+context")
    expect(prepared.attachments[0].transport).toBe("inline_data")
    expect(prepared.attachments[0].mimeType).toBe("image/png")
    expect(prepared.attachments[0].data).toBeTruthy()
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

describe("shouldAttachContentForChat", () => {
  it("attaches the inscription image on the first chat turn", () => {
    expect(
      shouldAttachContentForChat({
        chronicle,
        history: [],
        userMessage: "When was it minted?",
        mode: "qa",
        intent: "chronicle_query",
      })
    ).toBe(true)
  })

  it("reattaches the inscription image for follow-up visual questions", () => {
    const history: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "When was it minted?",
        createdAt: "2026-04-25T00:00:00.000Z",
        turnId: "t1",
      },
      {
        id: "a1",
        role: "assistant",
        content: "It was minted in block 840000.",
        createdAt: "2026-04-25T00:00:01.000Z",
        turnId: "t1",
      },
    ]

    expect(
      shouldAttachContentForChat({
        chronicle,
        history,
        userMessage: "Do que se refere a imagem?",
        mode: "qa",
        intent: "chronicle_query",
      })
    ).toBe(true)
  })

  it("keeps visual context for short follow-ups after a media-focused turn", () => {
    const history: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "What does the image show?",
        createdAt: "2026-04-25T00:00:00.000Z",
        turnId: "t1",
      },
      {
        id: "a1",
        role: "assistant",
        content: "It appears to show a stylized cat.",
        createdAt: "2026-04-25T00:00:01.000Z",
        turnId: "t1",
      },
    ]

    expect(
      shouldAttachContentForChat({
        chronicle,
        history,
        userMessage: "And the colors?",
        mode: "qa",
        intent: "chronicle_query",
      })
    ).toBe(true)
  })

  it("does not reattach the image for unrelated follow-ups", () => {
    const history: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "When was it minted?",
        createdAt: "2026-04-25T00:00:00.000Z",
        turnId: "t1",
      },
      {
        id: "a1",
        role: "assistant",
        content: "It was minted in block 840000.",
        createdAt: "2026-04-25T00:00:01.000Z",
        turnId: "t1",
      },
    ]

    expect(
      shouldAttachContentForChat({
        chronicle,
        history,
        userMessage: "Who owns it now?",
        mode: "qa",
        intent: "chronicle_query",
      })
    ).toBe(false)
  })

  it("attaches text-like inscription content on the first chat turn", () => {
    expect(
      shouldAttachContentForChat({
        chronicle: {
          ...chronicle,
          media_context: {
            kind: "html",
            content_type: "text/html",
            content_url: "https://ordinals.com/content/rooti0",
            preview_url: "https://ordinals.com/preview/rooti0",
            vision_eligible: false,
            vision_transport: "unsupported",
          },
        },
        history: [],
        userMessage: "Summarize this inscription.",
        mode: "qa",
        intent: "chronicle_query",
      })
    ).toBe(true)
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
