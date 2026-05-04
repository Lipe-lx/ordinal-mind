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
        { key: "Head", value: "Purple Wizard Hat", tokenCount: 286, percentage: 8.58 },
        { key: "Eyes", value: "Wide Open", tokenCount: 338, percentage: 10.14 },
        { key: "Head", value: "Purple Wizard Hat", tokenCount: 286, percentage: 8.58 },
        { key: "Facial Hair", value: " Long Beard ", tokenCount: 930, percentage: 27.91 },
      ],
    })

    expect(rarity?.traits).toEqual([
      { trait_type: "Head", value: "Purple Wizard Hat" },
      { trait_type: "Eyes", value: "Wide Open" },
      { trait_type: "Facial Hair", value: "Long Beard" },
    ])
    expect(rarity?.trait_breakdown).toHaveLength(3)
    expect(rarity?.trait_breakdown[0]).toMatchObject({
      trait_type: "Head",
      value: "Purple Wizard Hat",
      frequency: 286,
      frequency_pct: 8.58,
    })
  })

  it("falls back to computed percentages when the overlay does not provide them", () => {
    const rarity = buildInscriptionRarity(null, {
      source: "satflow",
      rank: 0,
      supply: 1000,
      traits: [
        { key: "Background", value: "Blue", tokenCount: 25 },
      ],
    })

    expect(rarity?.trait_breakdown).toEqual([
      expect.objectContaining({
        trait_type: "Background",
        value: "Blue",
        frequency: 25,
        frequency_pct: 2.5,
      }),
    ])
  })

  it("returns null when CBOR and market overlay traits are unavailable", () => {
    expect(buildInscriptionRarity(null, undefined)).toBeNull()
  })
})
