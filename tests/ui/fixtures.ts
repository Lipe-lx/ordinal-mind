import type { AddressResponse, ChronicleResponse, ScanProgress, WikiGraphPayload } from "../../src/app/lib/types"

const PNG_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' rx='32' fill='%230a0a0f'/%3E%3Ccircle cx='120' cy='120' r='64' fill='%23f7931a' fill-opacity='0.18'/%3E%3Cpath d='M58 148c0-46 36-82 82-82 20 0 38 7 52 18-9-2-17 3-23 12-7 10-12 14-20 14-9 0-14-5-20-12-7-7-13-13-25-13-21 0-38 15-38 39 0 7 1 15 4 24H58Z' fill='none' stroke='%23f7931a' stroke-width='12' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='120' cy='162' r='8' fill='%23f7931a'/%3E%3C/svg%3E"

export const chronicleFixture: ChronicleResponse = {
  inscription_id: "rooti0",
  meta: {
    inscription_id: "rooti0",
    inscription_number: 7,
    sat: 123456,
    sat_rarity: "rare",
    content_type: "image/png",
    content_url: PNG_DATA_URI,
    genesis_block: 840000,
    genesis_timestamp: "2024-04-20T00:00:00.000Z",
    genesis_fee: 1200,
    owner_address: "bc1pcurrentowner000000000000000000000000000000000000000000000",
    genesis_owner_address: "bc1pgenesisowner000000000000000000000000000000000000000000000",
    genesis_txid: "root",
    genesis_vout: 0,
    satpoint: "root:0:0",
    collection: {
      parent_inscription_id: "parent1i0",
      name: "Runestone",
    },
    recursive_refs: ["child1i0"],
    charms: ["vintage"],
  },
  events: [
    {
      id: "ev1",
      timestamp: "2024-04-20T00:00:00.000Z",
      block_height: 840000,
      event_type: "genesis",
      source: { type: "onchain", ref: "root" },
      description: "Inscribed by bc1pgenesisowner000000000000000000000000000000000000000000000",
      metadata: {
        address: "bc1pgenesisowner000000000000000000000000000000000000000000000",
      },
    },
    {
      id: "ev2",
      timestamp: "2024-05-01T00:00:00.000Z",
      block_height: 841000,
      event_type: "transfer",
      source: { type: "onchain", ref: "tx1" },
      description: "Transferred to bc1pcollector10000000000000000000000000000000000000000000000",
      metadata: {
        to: "bc1pcollector10000000000000000000000000000000000000000000000",
      },
    },
    {
      id: "ev3",
      timestamp: "2024-05-15T00:00:00.000Z",
      block_height: 842000,
      event_type: "sale",
      source: { type: "web", ref: "https://example.com/sale" },
      description: "Sold to bc1pcurrentowner000000000000000000000000000000000000000000000 for 0.12 BTC",
      metadata: {
        to: "bc1pcurrentowner000000000000000000000000000000000000000000000",
        price_btc: "0.12",
      },
    },
    {
      id: "ev4",
      timestamp: "2024-05-16T00:00:00.000Z",
      block_height: 842050,
      event_type: "collection_link",
      source: { type: "web", ref: "https://ord.net/collection/runestone" },
      description: "Linked to Runestone collection",
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
    content_url: PNG_DATA_URI,
    preview_url: PNG_DATA_URI,
    vision_eligible: true,
    vision_transport: "public_url",
  },
  collection_context: {
    protocol: {
      parents: {
        items: [
          {
            inscription_id: "parent1i0",
            inscription_number: 1,
            content_type: "image/png",
            content_url: PNG_DATA_URI,
            genesis_block: 839999,
            genesis_timestamp: "2024-04-19T00:00:00.000Z",
          },
        ],
        total_count: 1,
        more: false,
        source_ref: "https://ordinals.com/r/parents/rooti0/inscriptions",
        partial: false,
      },
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
        item_name: "Runestone #7",
        verified: true,
        source_ref: "https://ord.net/collection/runestone",
      },
      satflow_match: null,
      ord_net_match: {
        collection_slug: "runestone",
        collection_name: "Runestone",
        collection_href: "/collection/runestone",
        item_name: "Runestone #7",
        verified: true,
        source_ref: "https://ord.net/collection/runestone",
      },
      preferred_description: null,
      satflow_description: null,
      ord_net_description: null,
    },
    profile: {
      name: "Runestone",
      slug: "runestone",
      summary: "A public, source-backed profile used for UI regression tests.",
      creators: [],
      milestones: [],
      collector_signals: [
        {
          label: "Protocol provenance",
          value: "Parent inscription linked",
          source_ref: "https://ordinals.com/r/parents/rooti0/inscriptions",
        },
      ],
      market_stats: {
        source_ref: "https://www.satflow.com/ordinals/runestone",
        supply: "112.4K",
        listed: "288",
      },
      sources: [],
    },
    socials: {
      official_x_profiles: [
        {
          url: "https://x.com/runestone",
          source_ref: "https://example.com/x",
        },
      ],
    },
    presentation: {
      primary_label: "Runestone",
      item_label: "Runestone #7",
      full_label: "Runestone • #7",
      facets: [
        {
          label: "Collection",
          value: "Runestone",
          tone: "canonical",
        },
        {
          label: "Market supply",
          value: "112.4K",
          tone: "overlay",
        },
      ],
    },
  },
  source_catalog: [
    {
      source_type: "onchain",
      url_or_ref: "root",
      trust_level: "canonical_onchain",
      fetched_at: "2026-05-06T00:00:00.000Z",
      partial: false,
    },
    {
      source_type: "market_collection_ord_net",
      url_or_ref: "https://ord.net/collection/runestone",
      trust_level: "market_overlay",
      fetched_at: "2026-05-06T00:00:00.000Z",
      partial: false,
    },
  ],
  cached_at: "2026-05-06T00:00:00.000Z",
  from_cache: false,
  unisat_enrichment: {
    inscription_info: {
      charms: ["vintage"],
      sat: 123456,
      metaprotocol: null,
      content_length: 2048,
    },
    collection_context: {
      collection_id: "runestone",
      collection_name: "Runestone",
      floor_price_sats: 1200000,
      listed_count: 288,
      total_supply: 112400,
      verified: true,
    },
    rarity: {
      rarity_score: 42.8,
      rarity_rank: 321,
      rarity_percentile: 0.29,
      total_supply: 112400,
      traits: [
        {
          trait_type: "Background",
          value: "Dark",
        },
      ],
      trait_breakdown: [
        {
          trait_type: "Background",
          value: "Dark",
          frequency: 800,
          frequency_pct: 0.71,
          rarity_contribution: 19.2,
        },
      ],
      computed_at: "2026-05-06T00:00:00.000Z",
    },
    market_info: {
      listed: true,
      price_sats: 1200000,
      item_name: "Runestone #7",
    },
    source_catalog: [],
  },
  validation: {
    confidence: "high",
    checks: [],
    validated_at: "2026-05-06T00:00:00.000Z",
  },
}

export const addressFixture: AddressResponse = {
  type: "address",
  address: "bc1pfixtureaddress0000000000000000000000000000000000000000000",
  cursor: 0,
  total: 3,
  inscriptions: [
    {
      id: "rooti0",
      number: 7,
      content_type: "image/png",
      content_url: PNG_DATA_URI,
    },
    {
      id: "child1i0",
      number: 8,
      content_type: "text/plain",
      content_url: "data:text/plain,Ordinal%20Mind%20fixture",
    },
    {
      id: "child2i0",
      number: 9,
      content_type: "image/png",
      content_url: PNG_DATA_URI,
    },
  ],
}

export const wikiGraphFixture: WikiGraphPayload = {
  collection_slug: "runestone",
  focus_node_id: "collection:runestone",
  generated_at: "2026-05-06T00:00:00.000Z",
  partial: false,
  warnings: [],
  counts: {
    nodes: 4,
    edges: 3,
    fields: 1,
    claims: 1,
    wiki_pages: 1,
    source_events: 1,
    external_refs: 0,
  },
  nodes: [
    {
      id: "collection:runestone",
      kind: "collection",
      label: "Runestone",
      status: "canonical",
      description: "Collection root",
      metadata: {
        sample_inscription_id: "rooti0",
      },
    },
    {
      id: "field:runestone:founder",
      kind: "field",
      label: "Founder",
      status: "canonical",
      parent_id: "collection:runestone",
      description: "Canonical field",
      metadata: {
        field: "founder",
      },
    },
    {
      id: "claim:runestone:founder",
      kind: "claim",
      label: "Casey Rodarmor",
      status: "canonical",
      parent_id: "field:runestone:founder",
      description: "Source-backed claim",
      metadata: {
        contribution_id: "claim-1",
      },
    },
    {
      id: "wiki:rooti0",
      kind: "wiki_page",
      label: "Inscription #7",
      status: "supporting",
      description: "Linked inscription page",
      href: "/chronicle/rooti0",
      metadata: {
        inscription_id: "rooti0",
      },
    },
  ],
  edges: [
    {
      id: "edge-1",
      kind: "has_field",
      source: "collection:runestone",
      target: "field:runestone:founder",
      status: "canonical",
      metadata: {},
    },
    {
      id: "edge-2",
      kind: "has_claim",
      source: "field:runestone:founder",
      target: "claim:runestone:founder",
      status: "canonical",
      metadata: {},
    },
    {
      id: "edge-3",
      kind: "belongs_to_collection",
      source: "wiki:rooti0",
      target: "collection:runestone",
      status: "supporting",
      metadata: {},
    },
  ],
}

export const scanProgressFixture: ScanProgress = {
  phase: "transfers",
  step: 2,
  total: 4,
  description: "Reconstructing on-chain transfers",
}
