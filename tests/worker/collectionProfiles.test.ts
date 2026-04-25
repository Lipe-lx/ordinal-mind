import { describe, expect, it } from "vitest"
import {
  buildCuratedCollectionProfile,
  hasCuratedCollectionProfile,
} from "../../src/worker/collectionProfiles"

describe("curated collection profiles", () => {
  it("builds a source-backed Runestone profile from normalized slugs", () => {
    const profile = buildCuratedCollectionProfile({
      slug: "runestone",
      name: "Runestone",
      fetchedAt: "2026-04-25T00:00:00.000Z",
      fallbackSourceRef: "https://ord.net/inscription/example",
      marketStats: {
        source_ref: "https://www.satflow.com/ordinals/runestone",
        supply: "112.4K",
      },
    })

    expect(profile).toMatchObject({
      name: "Runestone",
      slug: "runestone",
      market_stats: {
        supply: "112.4K",
      },
    })
    expect(profile?.creators.map((creator) => creator.value)).toContain("Leonidas")
    expect(profile?.milestones.some((fact) => fact.label === "Distribution design")).toBe(true)
    expect(profile?.collector_signals.some((fact) => fact.label === "Protocol provenance")).toBe(true)
    expect(profile?.sources.every((source) => source.trust_level === "curated_public_research")).toBe(true)
  })

  it("matches simple aliases and rejects unknown collections", () => {
    expect(hasCuratedCollectionProfile("runestones")).toBe(true)
    expect(hasCuratedCollectionProfile("unknown_collection")).toBe(false)
  })
})
