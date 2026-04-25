import { afterEach, describe, expect, it, vi } from "vitest"
import type { InscriptionMeta } from "../../src/app/lib/types"
import {
  buildMediaContext,
  findLegacyCollectionMembership,
  parseOrdMarketOverlay,
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
      vision_eligible: true,
      vision_transport: "public_url",
    })
  })

  it("keeps SVG inscriptions in text-only mode", () => {
    const media = buildMediaContext({
      ...baseMeta,
      content_type: "image/svg+xml",
    })

    expect(media.vision_eligible).toBe(false)
    expect(media.kind).toBe("svg")
    expect(media.fallback_reason).toContain("text-only")
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
