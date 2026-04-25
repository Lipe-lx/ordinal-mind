import { describe, expect, it } from "vitest"
import { buildInscriptionRarity } from "../../src/worker/rarity"

describe("rarity builder", () => {
  it("drops empty and duplicate traits before rendering", () => {
    const rarity = buildInscriptionRarity(null, {
      source: "satflow",
      rank: 0,
      supply: 3333,
      traits: [
        { key: " ", value: "0", tokenCount: 1 },
        { key: "Head", value: "Purple Wizard Hat", tokenCount: 286 },
        { key: "Eyes", value: "Wide Open", tokenCount: 338 },
        { key: "Head", value: "Purple Wizard Hat", tokenCount: 286 },
        { key: "Facial Hair", value: " Long Beard ", tokenCount: 930 },
      ],
    })

    expect(rarity?.traits).toEqual([
      { trait_type: "Head", value: "Purple Wizard Hat" },
      { trait_type: "Eyes", value: "Wide Open" },
      { trait_type: "Facial Hair", value: "Long Beard" },
    ])
    expect(rarity?.trait_breakdown).toHaveLength(3)
  })

  it("returns null when CBOR and market overlay traits are unavailable", () => {
    expect(buildInscriptionRarity(null, undefined)).toBeNull()
  })
})
