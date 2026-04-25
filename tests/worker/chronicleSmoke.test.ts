import { afterEach, describe, expect, it, vi } from "vitest"
import cbor from "cbor"
import worker, { type Env } from "../../src/worker/index"

const INSCRIPTION_ID = `${"a".repeat(64)}i0`
const GENESIS_TXID = "a".repeat(64)

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function createEnv(): Env {
  const kvStore = new Map<string, string>()
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

function satflowOrdinalHtml(options: { withCount: boolean; rank: number; includeTraits?: boolean }): string {
  const backgroundTrait = options.withCount
    ? `{"key":"Background","value":"Dark Grey","count":800}`
    : `{"key":"Background","value":"Dark Grey"}`
  const attributes = options.includeTraits === false
    ? ""
    : `"attributes": [
          {"key":"Attributes","value":"None","count":5159},
          ${backgroundTrait}
        ]`
  return `
    <meta property="og:title" content="Bitcoin Puppet #2971 - Bitcoin Puppets" />
    <a href="/ordinals/bitcoin-puppets">Bitcoin Puppets</a>
    <script>
      window.__DATA__ = {
        "rarityRank": ${options.rank},
        "totalSupply": 5159,
        ${attributes}
      }
    </script>
  `
}

function setupUpstreamMocks(options: {
  metadataStatus: number
  metadataPayload: unknown
  satflowWithCount: boolean
  satflowRank: number
  satflowIncludeTraits?: boolean
  ordNetTraitFallback?: boolean
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === `https://ordinals.com/r/inscription/${INSCRIPTION_ID}`) {
        return jsonResponse({
          id: INSCRIPTION_ID,
          number: 2971,
          sat: 1403294488638613,
          content_type: "image/webp",
          height: 840000,
          timestamp: 1713571200,
          fee: 1200,
          address: "bc1ptestaddress",
          output: `${GENESIS_TXID}:0`,
          satpoint: `${GENESIS_TXID}:0:0`,
        })
      }

      if (url === "https://ordinals.com/r/sat/1403294488638613") {
        return jsonResponse({ rarity: "common" })
      }

      if (url === `https://ordinals.com/r/metadata/${INSCRIPTION_ID}`) {
        if (options.metadataStatus !== 200) {
          return new Response("not found", { status: options.metadataStatus })
        }
        return jsonResponse(options.metadataPayload)
      }

      if (url === `https://ordinals.com/inscription/${INSCRIPTION_ID}`) {
        return jsonResponse({
          id: INSCRIPTION_ID,
          number: 2971,
          properties: {
            attributes: {
              title: "Bitcoin Puppet #2971",
            },
          },
        })
      }

      if (url.includes(`/r/parents/${INSCRIPTION_ID}/inscriptions`)) {
        return jsonResponse({ parents: [], more: false, page: 0 })
      }

      if (url.includes(`/r/children/${INSCRIPTION_ID}/inscriptions`)) {
        return jsonResponse({ children: [], more: false, page: 0 })
      }

      if (url === `https://ord.net/inscription/${INSCRIPTION_ID}`) {
        return textResponse(options.ordNetTraitFallback
          ? `
            collection:"bitcoin-puppets"
            collectionHref:"/collection/bitcoin-puppets"
            collection:{name:"Bitcoin Puppets",verified:true,items:5159}
            item:{name:"Bitcoin Puppet #2971"}
            verifiedGalleryTraitGroups:[{gallery:{id:"gallery-1",slug:"bitcoin-puppets",href:"/collection/bitcoin-puppets",name:"Bitcoin Puppets"},traits:[{type:"Background",value:"Dark Grey",count:800,percentage:15.5},{type:"Eyes",value:"Wide Open",count:338,percentage:6.5}]}]
          `
          : `
            collection:"bitcoin-puppets"
            collectionHref:"/collection/bitcoin-puppets"
            collection:{name:"Bitcoin Puppets",verified:true}
            item:{name:"Bitcoin Puppet #2971"}
          `)
      }

      if (url === `https://www.satflow.com/ordinal/${INSCRIPTION_ID}`) {
        return textResponse(
          satflowOrdinalHtml({
            withCount: options.satflowWithCount,
            rank: options.satflowRank,
            includeTraits: options.satflowIncludeTraits,
          })
        )
      }

      if (url === "https://www.satflow.com/ordinals/bitcoin-puppets") {
        return textResponse(`
          <span>7D Change</span><strong>-18.1%</strong>
          <span>7D Volume</span><strong>0.42</strong>
          <span>Supply</span><strong>112.4K</strong>
          <span>Listed</span><strong>288</strong>
          <span>Market Cap</span><strong>126.97</strong>
        `)
      }

      if (url === "https://ord.net") {
        return textResponse("<main><h2>Popular</h2><h2>Trending</h2></main>")
      }

      if (
        url === "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections.json" ||
        url === "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections-needs-info.json"
      ) {
        return jsonResponse([])
      }

      if (url === `https://mempool.space/api/tx/${GENESIS_TXID}/outspend/0`) {
        return jsonResponse({ spent: false })
      }

      if (url === `https://mempool.space/api/tx/${GENESIS_TXID}`) {
        return jsonResponse({
          txid: GENESIS_TXID,
          status: {
            confirmed: true,
            block_height: 840000,
            block_time: 1713571200,
          },
          fee: 1200,
          vin: [],
          vout: [
            {
              scriptpubkey_address: "bc1pgenesisowner",
              value: 10000,
            },
          ],
        })
      }

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response("", { status: 503 })
      }

      return new Response(`unmocked url: ${url}`, { status: 404 })
    })
  )
}

async function callChronicle(debug = true): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  const request = new Request(
    `https://ordinalmind.local/api/chronicle?id=${INSCRIPTION_ID}${debug ? "&debug=1" : ""}`
  )
  const response = await worker.fetch(request, createEnv())
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  }
}

describe("chronicle pipeline smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps trait context when on-chain metadata and satflow rarity are available", async () => {
    const hex = cbor.encode({
      attributes: [
        { trait_type: "Background", value: "Dark Grey" },
        { trait_type: "Item", value: "Keyboard" },
      ],
    }).toString("hex")

    setupUpstreamMocks({
      metadataStatus: 200,
      metadataPayload: hex,
      satflowWithCount: true,
      satflowRank: 321,
      satflowIncludeTraits: true,
    })

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const { status, body } = await callChronicle(true)

    expect(status).toBe(200)

    const enrichment = body.unisat_enrichment as Record<string, unknown>
    const rarity = enrichment?.rarity as Record<string, unknown>
    const traits = rarity?.traits as Array<Record<string, unknown>>
    expect(traits.length).toBeGreaterThan(0)
    expect(traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trait_type: "Background",
          value: "Dark Grey",
        }),
      ])
    )
    expect(rarity.rarity_rank).toBe(321)

    const market = (body.collection_context as Record<string, unknown>).market as Record<string, unknown>
    const match = market.match as Record<string, unknown>
    const satflowRarity = match.satflow_rarity as Record<string, unknown>
    expect((satflowRarity.traits as unknown[]).length).toBeGreaterThan(0)

    expect(
      infoSpy.mock.calls.some((call) =>
        String(call[0]).includes("rarity_pipeline_summary")
      )
    ).toBe(true)
  })

  it("falls back to satflow attributes when ordinals metadata is unavailable", async () => {
    setupUpstreamMocks({
      metadataStatus: 404,
      metadataPayload: null,
      satflowWithCount: false,
      satflowRank: 0,
      satflowIncludeTraits: true,
    })

    const { status, body } = await callChronicle(true)
    expect(status).toBe(200)

    const enrichment = body.unisat_enrichment as Record<string, unknown>
    const rarity = enrichment?.rarity as Record<string, unknown>
    const traits = rarity?.traits as Array<Record<string, unknown>>

    expect(traits.length).toBeGreaterThan(0)
    expect(traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trait_type: "Background",
          value: "Dark Grey",
        }),
      ])
    )
  })

  it("falls back to ord.net gallery traits when Satflow has no trait block", async () => {
    setupUpstreamMocks({
      metadataStatus: 404,
      metadataPayload: null,
      satflowWithCount: false,
      satflowRank: 0,
      satflowIncludeTraits: false,
      ordNetTraitFallback: true,
    })

    const { status, body } = await callChronicle(true)
    expect(status).toBe(200)

    const enrichment = body.unisat_enrichment as Record<string, unknown>
    const rarity = enrichment?.rarity as Record<string, unknown>
    const traits = rarity?.traits as Array<Record<string, unknown>>

    expect(traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trait_type: "Background",
          value: "Dark Grey",
        }),
      ])
    )

    const sourceCatalog = enrichment.source_catalog as Array<Record<string, unknown>>
    expect(sourceCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: "market_rarity_overlay",
          url_or_ref: `https://ord.net/inscription/${INSCRIPTION_ID}`,
        }),
      ])
    )
  })
})
