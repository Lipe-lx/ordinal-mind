import { afterEach, describe, expect, it, vi } from "vitest"
import type { InscriptionMeta } from "../../src/app/lib/types"
import {
  buildCollectionProfile,
  buildMediaContext,
  findLegacyCollectionMembership,
  parseCoinGeckoNftOfficialXProfiles,
  parseOrdMarketOverlay,
  parseOrdNetCollectionDirectory,
  parseOfficialXProfileLinks,
  parseSatflowInscriptionOverlay,
  parseSatflowCollectionStats,
  parseRegistryEntries,
  selectRegistryMatch,
  selectRegistryMatchFromMarketOverlay,
} from "../../src/worker/agents/collections"

const baseMeta: InscriptionMeta = {
  inscription_id: "meta123i0",
  inscription_number: 42,
  sat: 123,
  sat_rarity: "common",
  content_type: "image/png",
  content_url: "https://ordinals.com/content/meta123i0",
  genesis_block: 840000,
  genesis_timestamp: "2024-04-20T00:00:00.000Z",
  genesis_fee: 1234,
  owner_address: "bc1ptest",
  genesis_txid: "meta123",
  genesis_vout: 0,
}

describe("collection registry parsing", () => {
  it("parses parent and gallery registry entries", () => {
    const entries = parseRegistryEntries(
      [
        { name: "Quantum Cats", type: "parent", ids: ["parent1i0"], slug: "quantum_cats" },
        { name: "Taproot Wizards", type: "gallery", id: "gallery1i0", slug: "taproot_wizards" },
      ],
      "verified"
    )

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: "parent", name: "Quantum Cats" })
    expect(entries[1]).toMatchObject({ type: "gallery", name: "Taproot Wizards" })
  })

  it("keeps issues for needs_info entries", () => {
    const entries = parseRegistryEntries(
      [
        {
          name: "Unclear Gallery",
          type: "gallery",
          id: "gallery2i0",
          slug: "unclear_gallery",
          issues: ["missing provenance"],
        },
      ],
      "needs_info"
    )

    expect(entries[0]).toMatchObject({
      type: "gallery",
      issues: ["missing provenance"],
    })
  })
})

describe("registry match precedence", () => {
  it("returns null when there is no curated match", () => {
    const match = selectRegistryMatch({
      inscriptionId: "inscriptioni0",
      parentIds: new Set(["otherparenti0"]),
      galleryId: undefined,
      verifiedEntries: [],
      needsInfoEntries: [],
    })

    expect(match).toBeNull()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prefers verified parent provenance over needs_info gallery matches", () => {
    const match = selectRegistryMatch({
      inscriptionId: "childi0",
      parentIds: new Set(["parent1i0"]),
      galleryId: "gallery1i0",
      verifiedEntries: parseRegistryEntries(
        [{ name: "Verified Parent", type: "parent", ids: ["parent1i0"], slug: "verified_parent" }],
        "verified"
      ),
      needsInfoEntries: parseRegistryEntries(
        [{
          name: "Unclear Gallery",
          type: "gallery",
          id: "gallery1i0",
          slug: "unclear_gallery",
          issues: ["needs review"],
        }],
        "needs_info"
      ),
    })

    expect(match).toMatchObject({
      matched_collection: "Verified Parent",
      match_type: "parent",
      quality_state: "verified",
    })
  })

  it("returns needs_info metadata when that is the only match", () => {
    const match = selectRegistryMatch({
      inscriptionId: "gallery-rooti0",
      parentIds: new Set(),
      galleryId: "gallery-rooti0",
      verifiedEntries: [],
      needsInfoEntries: parseRegistryEntries(
        [{
          name: "Pending Gallery",
          type: "gallery",
          id: "gallery-rooti0",
          slug: "pending_gallery",
          issues: ["unverified creator"],
        }],
        "needs_info"
      ),
    })

    expect(match).toMatchObject({
      matched_collection: "Pending Gallery",
      match_type: "gallery",
      quality_state: "needs_info",
      issues: ["unverified creator"],
    })
  })

  it("promotes ord.net gallery membership only after legacy list confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "childi0",
            meta: {
              name: "Wizard #2212",
            },
          },
        ],
      } satisfies Partial<Response>)
    )

    const result = await selectRegistryMatchFromMarketOverlay(
      "childi0",
      {
        collection_slug: "wizards",
        collection_name: "The Wizards of Ord",
        collection_href: "/collection/wizards",
        item_name: "Wizard #2212",
        verified: true,
        source_ref: "https://ord.net/inscription/11339504",
      },
      parseRegistryEntries(
        [{ name: "The Wizards of Ord", type: "gallery", id: "gallery-rooti0", slug: "wizards" }],
        "verified"
      ),
      [],
      "2026-04-25T00:00:00.000Z",
      []
    )

    expect(result?.match).toMatchObject({
      matched_collection: "The Wizards of Ord",
      match_type: "gallery",
      quality_state: "verified",
      slug: "wizards",
      source_ref:
        "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/legacy/collections/wizards.json",
    })
    expect(result?.issues).toEqual([])
  })
})

describe("media context", () => {
  it("marks image inscriptions as vision eligible", () => {
    expect(buildMediaContext(baseMeta)).toMatchObject({
      kind: "image",
      preview_url: "https://ordinals.com/preview/meta123i0",
      vision_eligible: true,
      vision_transport: "public_url",
    })
  })

  it("keeps SVG inscriptions in preview-backed text-only mode", () => {
    const media = buildMediaContext({
      ...baseMeta,
      content_type: "image/svg+xml",
    })

    expect(media.vision_eligible).toBe(false)
    expect(media.kind).toBe("svg")
    expect(media.preview_url).toBe("https://ordinals.com/preview/meta123i0")
    expect(media.fallback_reason).toContain("ordinals preview")
  })

  it("routes model inscriptions through ordinals preview", () => {
    const media = buildMediaContext({
      ...baseMeta,
      content_type: "model/gltf+json",
    })

    expect(media).toMatchObject({
      kind: "model",
      preview_url: "https://ordinals.com/preview/meta123i0",
      vision_eligible: false,
      vision_transport: "unsupported",
    })
  })
})

describe("ord.net market overlay parsing", () => {
  it("extracts verified collection data from the inscription page payload", () => {
    const html = `__sveltekit_x.resolve(1, () => [{item:{name:"Wizard #2212",collection:"wizards",collectionHref:"/collection/wizards",owner:"bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx"},collection:{slug:"wizards",href:"/collection/wizards",name:"The Wizards of Ord",verified:true},verifiedCollections:[{slug:"wizards",href:"/collection/wizards",name:"The Wizards of Ord"}]}])`

    expect(parseOrdMarketOverlay(html, "https://ord.net/inscription/11339504")).toMatchObject({
      collection_slug: "wizards",
      collection_name: "The Wizards of Ord",
      collection_href: "/collection/wizards",
      item_name: "Wizard #2212",
      verified: true,
      owner_address: "bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx",
      source_ref: "https://ord.net/inscription/11339504",
    })
  })

  it("extracts verified gallery traits when ord.net exposes the collection payload", () => {
    const html = `
      item:{name:"Wizard #2983",collection:"wizards",collectionHref:"/collection/wizards"}
      collection:{slug:"wizards",href:"/collection/wizards",name:"The Wizards of Ord",verified:true,items:3333}
      verifiedGalleryTraitGroups:[{gallery:{id:"gallery-1",slug:"wizards",href:"/collection/wizards",name:"The Wizards of Ord"},traits:[{type:"Clothes",value:"Starry Blue Robe",count:252,percentage:7.6},{type:"Eyes",value:"Wide Open",count:338,percentage:10.1},{type:"Head",value:"Starry Blue Wizard Hat",count:255,percentage:7.7}]}]
    `

    expect(parseOrdMarketOverlay(html, "https://ord.net/inscription/11337510")).toMatchObject({
      collection_slug: "wizards",
      collection_name: "The Wizards of Ord",
      rarity_overlay: {
        source: "ord_net",
        rank: 0,
        supply: 3333,
        source_ref: "https://ord.net/inscription/11337510",
        traits: [
          { key: "Clothes", value: "Starry Blue Robe", tokenCount: 252 },
          { key: "Eyes", value: "Wide Open", tokenCount: 338 },
          { key: "Head", value: "Starry Blue Wizard Hat", tokenCount: 255 },
        ],
      },
    })
  })

  it("extracts collection data from escaped ord.net payload blocks", () => {
    const html = `
      <script>
        self.__data = "item:{\\"name\\":\\"NodeMonke #1\\",\\"collection\\":\\"nodemonkes\\",\\"collectionHref\\":\\"/collection/nodemonkes\\"},collection:{\\"slug\\":\\"nodemonkes\\",\\"href\\":\\"/collection/nodemonkes\\",\\"name\\":\\"NodeMonkes\\",\\"verified\\":true},verifiedCollections:[{\\"slug\\":\\"nodemonkes\\",\\"href\\":\\"/collection/nodemonkes\\",\\"name\\":\\"NodeMonkes\\"}]"
      </script>
    `

    expect(parseOrdMarketOverlay(html, "https://ord.net/inscription/example")).toMatchObject({
      collection_slug: "nodemonkes",
      collection_name: "NodeMonkes",
      collection_href: "/collection/nodemonkes",
      item_name: "NodeMonke #1",
      verified: true,
      source_ref: "https://ord.net/inscription/example",
    })
  })
})

describe("Satflow collection stats parsing", () => {
  it("extracts public collection stats from a rendered collection page", () => {
    const html = `
      <h1>Runestone</h1>
      <span>7D Change</span><strong>-18.1%</strong>
      <span>7D Volume</span><strong>0.42</strong>
      <span>Supply</span><strong>112.4K</strong>
      <span>Listed</span><strong>288</strong>
      <span>Market Cap</span><strong>126.97</strong>
    `

    expect(parseSatflowCollectionStats(html, "https://www.satflow.com/ordinals/runestone")).toMatchObject({
      source_ref: "https://www.satflow.com/ordinals/runestone",
      change_7d: "-18.1%",
      volume_7d: "0.42",
      supply: "112.4K",
      listed: "288",
      market_cap: "126.97",
    })
  })

  it("ignores placeholder tokens that are not real metrics", () => {
    const html = `
      <span>7D Change</span><strong>7D</strong>
      <span>7D Volume</span><strong>Supply</strong>
      <span>Supply</span><strong>Range</strong>
      <span>Listed</span><strong>Market</strong>
      <span>Market Cap</span><strong>Lowest</strong>
    `

    expect(parseSatflowCollectionStats(html, "https://www.satflow.com/ordinals/runestone")).toBeNull()
  })
})

describe("official X link parsing", () => {
  it("extracts canonical profile urls from public collection pages", () => {
    const html = `
      <a href="https://twitter.com/bitcoinpuppets?ref_src=twsrc%5Egoogle">X</a>
      <a href="https://x.com/bitcoinpuppets/status/1234567890">Latest post</a>
      <a href="https://x.com/share?text=Bitcoin%20Puppets">Share</a>
      <a href="https://x.com/bitcoinpuppets">Official handle</a>
    `

    expect(parseOfficialXProfileLinks(html, {
      collectionSlug: "bitcoin-puppets",
      collectionName: "Bitcoin Puppets",
    })).toEqual([
      "https://x.com/bitcoinpuppets",
    ])
  })

  it("filters platform accounts that do not match the collection identity", () => {
    const html = `
      <a href="https://x.com/Satflow">Satflow</a>
      <a href="https://x.com/TheWizardsOfOrd">The Wizards of Ord</a>
      <a href="https://x.com/bitcoinpuppets">Bitcoin Puppets</a>
      <script>window.__COMMUNITY__ = {"x":"https://x.com/bitcoinpuppets"}</script>
    `

    expect(parseOfficialXProfileLinks(html, {
      collectionSlug: "bitcoin-puppets",
      collectionName: "Bitcoin Puppets",
    })).toEqual([
      "https://x.com/bitcoinpuppets",
    ])
  })

  it("accepts CoinGecko collection twitter links as social seeds", () => {
    expect(parseCoinGeckoNftOfficialXProfiles({
      id: "bitcoin-weirdos",
      name: "Bitcoin Weirdos",
      links: {
        twitter: "https://twitter.com/F___T___W",
      },
    }, "https://api.coingecko.com/api/v3/nfts/bitcoin-weirdos")).toEqual([
      {
        url: "https://x.com/F___T___W",
        source_ref: "https://api.coingecko.com/api/v3/nfts/bitcoin-weirdos",
      },
    ])
  })
})

describe("Satflow inscription overlay parsing", () => {
  it("keeps trait frequencies when Satflow exposes `count` and rank is zero", () => {
    const html = `
      <meta property="og:title" content="Bitcoin Puppet #2971 - Bitcoin Puppets" />
      <a href="/ordinals/bitcoin-puppets">Bitcoin Puppets</a>
      <script>
        window.__DATA__ = {
          "rarityRank":0,
          "totalSupply":5159,
          "attributes":[
            {"key":"Attributes","value":"None","count":5159},
            {"key":"Background","value":"Dark Grey","count":800}
          ]
        }
      </script>
    `

    expect(parseSatflowInscriptionOverlay(html, "https://www.satflow.com/ordinal/abc")).toMatchObject({
      collection_slug: "bitcoin-puppets",
      collection_name: "Bitcoin Puppets",
      item_name: "Bitcoin Puppet #2971",
      rarity_overlay: {
        source: "satflow",
        rank: 0,
        supply: 5159,
        traits: [
          { key: "Attributes", value: "None", tokenCount: 5159 },
          { key: "Background", value: "Dark Grey", tokenCount: 800 },
        ],
      },
    })
  })

  it("prefers the richest attributes block when Satflow emits multiple copies", () => {
    const html = `
      <meta property="og:title" content="Wizard #2983 - The Wizards of Ord" />
      <script>
        window.__DATA__ = {
          "collectionSlug":"wizards",
          "rarityRank":0,
          "attributes":[
            {"key":"Type","value":"Ape"},
            {"key":"Eyes","value":"Wide Open"}
          ],
          "attributes":[
            {"key":"Type","value":"Ape","tokenCount":436},
            {"key":"Eyes","value":"Wide Open","tokenCount":338},
            {"key":"Weapon","value":"Dagger","tokenCount":266}
          ],
          "attributes":[
            {"key":"Type","value":"Ape","count":436}
          ]
        }
      </script>
    `

    expect(parseSatflowInscriptionOverlay(html, "https://www.satflow.com/ordinal/wizard")).toMatchObject({
      collection_slug: "wizards",
      rarity_overlay: {
        source: "satflow",
        source_ref: "https://www.satflow.com/ordinal/wizard",
        traits: [
          { key: "Type", value: "Ape", tokenCount: 436 },
          { key: "Eyes", value: "Wide Open", tokenCount: 338 },
          { key: "Weapon", value: "Dagger", tokenCount: 266 },
        ],
      },
    })
  })

  it("parses traits from escaped __next_f payload blocks", () => {
    const html = `
      <meta property="og:title" content="Quantum Cat #1105 - Quantum Cats" />
      <a href="/ordinals/quantum_cats">Quantum Cats</a>
      <script>
        self.__next_f.push([1,"meta:{\\\"token\\\":{\\\"inscription_id\\\":\\\"6e357...i104\\\",\\\"attributes\\\":[{\\\"key\\\":\\\"Background\\\",\\\"value\\\":\\\"Concatenation\\\",\\\"tokenCount\\\":141},{\\\"key\\\":\\\"Body\\\",\\\"value\\\":\\\"Purple Haze\\\",\\\"tokenCount\\\":103}]},\\\"rarityRank\\\":0}"])
      </script>
    `

    expect(parseSatflowInscriptionOverlay(html, "https://www.satflow.com/ordinal/qcat-1105")).toMatchObject({
      collection_slug: "quantum_cats",
      rarity_overlay: {
        source: "satflow",
        rank: 0,
        source_ref: "https://www.satflow.com/ordinal/qcat-1105",
        traits: [
          { key: "Background", value: "Concatenation", tokenCount: 141 },
          { key: "Body", value: "Purple Haze", tokenCount: 103 },
        ],
      },
    })
  })
})

describe("collection profile marketplace signals", () => {
  it("adds Satflow as collector-facing market evidence when stats are available", () => {
    const profile = buildCollectionProfile(
      null,
      {
        collection_slug: "bitcoin-puppets",
        collection_name: "Bitcoin Puppets",
        collection_href: "/collection/bitcoin-puppets",
        verified: true,
        source_ref: "https://ord.net/inscription/example",
      },
      {
        source_ref: "https://www.satflow.com/ordinals/bitcoin-puppets",
        floor_price: "0.3870",
        volume_7d: "1.23",
        supply: "10K",
        listed: "420",
      },
      null,
      "2026-04-25T00:00:00.000Z"
    )

    expect(profile?.collector_signals).toContainEqual(expect.objectContaining({
      label: "Satflow collection market",
      source_ref: "https://www.satflow.com/ordinals/bitcoin-puppets",
    }))
    expect(profile?.collector_signals.find((signal) => signal.label === "Satflow collection market")?.value)
      .toContain("supply 10K")
  })
})

describe("ord.net collection directory parsing", () => {
  it("extracts popular, trending, and recently verified collections", () => {
    const html = `
      <main>
        <h2>Popular</h2>
        <a>Ordinal Maxi Biz (OMB)</a><span>Popular</span>
        <a>Bitcoin Puppets</a><span>Popular</span>
        <a>Runestone</a><span>Popular</span>
        <h2>Trending</h2>
        <h1>Collection Trend (24h)</h1>
        1 Ordinal Maxi Biz (OMB) Ordinal Maxi Biz (OMB) — 0.8787 — — 9,000
        2 Bitcoin Puppets Bitcoin Puppets — 0.3870 — — 10,001
        3 Runestone Runestone — 0.1462 — — 112,383
        <h2>Recently Verified</h2>
        <a>Ordinal Punks</a><span>Floor — Listed — 24h —</span>
        <a>Bitcoin Punks</a><span>Floor — Listed — 24h —</span>
      </main>
    `

    const entries = parseOrdNetCollectionDirectory(html, "https://ord.net/")

    expect(entries).toContainEqual(expect.objectContaining({
      name: "Runestone",
      slug: "runestone",
      section: "popular",
    }))
    expect(entries).toContainEqual(expect.objectContaining({
      name: "Runestone",
      section: "trending",
      rank: 3,
      volume_24h: "0.1462",
      supply: "112,383",
    }))
    expect(entries).toContainEqual(expect.objectContaining({
      name: "Ordinal Punks",
      slug: "ordinal-punks",
      section: "recently_verified",
    }))
  })
})

describe("legacy gallery membership", () => {
  it("finds an inscription inside the legacy collection list", () => {
    expect(
      findLegacyCollectionMembership(
        [
          {
            id: "c889af3517f9145a246e6bc1cf38ed7b7837ec8ad7d5c8308f71648dd9582709i0",
            meta: {
              name: "Wizard #2212",
            },
          },
        ],
        "c889af3517f9145a246e6bc1cf38ed7b7837ec8ad7d5c8308f71648dd9582709i0"
      )
    ).toEqual({
      inscription_id: "c889af3517f9145a246e6bc1cf38ed7b7837ec8ad7d5c8308f71648dd9582709i0",
      item_name: "Wizard #2212",
    })
  })
})
