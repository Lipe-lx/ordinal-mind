import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"

function createEnv(): Env {
  const kvStore = new Map<string, string>()
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
      protocol: { parents: null, children: null, gallery: null, grandparents: null, greatGrandparents: null },
      registry: { match: null, issues: [] },
      market: { match: null },
      profile: null,
      socials: { official_x_profiles: [] },
      presentation: { facets: [] },
    },
    source_catalog: [],
    cached_at: "2024-01-01T00:00:00.000Z",
  }

  kvStore.set("abc123i0", JSON.stringify(chronicle))

  return {
    CHRONICLES_KV: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    } as unknown as KVNamespace,
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 }),
    },
    ENVIRONMENT: "test",
  }
}

describe("wiki routes contract-first", () => {
  it("returns structured 404 for missing wiki page", async () => {
    const req = new Request("https://ordinalmind.local/api/wiki/inscription:abc123i0")
    const res = await worker.fetch(req, createEnv())
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("wiki_page_not_found")
  })

  it("returns timeline via wiki tool", async () => {
    const req = new Request("https://ordinalmind.local/api/wiki/tools/get_timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscription_id: "abc123i0" }),
    })

    const res = await worker.fetch(req, createEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.inscription_id).toBe("abc123i0")
  })

  it("returns collection context via wiki tool", async () => {
    const req = new Request("https://ordinalmind.local/api/wiki/tools/get_collection_context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscription_id: "abc123i0" }),
    })

    const res = await worker.fetch(req, createEnv())
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.collection_context).toBeTruthy()
  })
})
