import { describe, expect, it } from "vitest"
import type { InscriptionMeta } from "../../src/app/lib/types"
import type { UnisatInscriptionInfo } from "../../src/worker/agents/unisat"
import { validateAcrossSources } from "../../src/worker/validation"

function makeMeta(overrides: Partial<InscriptionMeta> = {}): InscriptionMeta {
  return {
    inscription_id: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1i0",
    inscription_number: 7,
    sat: 123,
    sat_rarity: "common",
    content_type: "image/png",
    content_url: "https://ordinals.com/content/example",
    genesis_block: 100,
    genesis_timestamp: "2026-04-29T00:00:00.000Z",
    genesis_fee: 10,
    owner_address: "bc1pownerexample0000000000000000000000000000000000000000000000000",
    genesis_txid: "f".repeat(64),
    genesis_vout: 0,
    ...overrides,
  }
}

function makeUnisatInfo(overrides: Partial<UnisatInscriptionInfo> = {}): UnisatInscriptionInfo {
  return {
    inscriptionId: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1i0",
    inscriptionNumber: 7,
    address: "bc1pownerexample0000000000000000000000000000000000000000000000000",
    contentType: "image/png",
    contentLength: 100,
    height: 100,
    timestamp: 1_714_348_800,
    sat: 123,
    genesisTransaction: "f".repeat(64),
    offset: 0,
    charms: [],
    metaprotocol: null,
    ...overrides,
  }
}

describe("validateAcrossSources", () => {
  it("cross-validates negative inscription numbers", () => {
    const result = validateAcrossSources(
      makeMeta({ inscription_number: -435195 }),
      makeUnisatInfo({ inscriptionNumber: -435195 })
    )

    const numberCheck = result.checks.find((check) => check.field === "inscription_number")
    expect(numberCheck).toBeDefined()
    expect(numberCheck?.sources_agree).toBe(true)
    expect(numberCheck?.values).toEqual([
      { source: "ordinals.com", value: "-435195" },
      { source: "unisat", value: "-435195" },
    ])
  })

  it("cross-validates inscription zero", () => {
    const result = validateAcrossSources(
      makeMeta({ inscription_number: 0 }),
      makeUnisatInfo({ inscriptionNumber: 0 })
    )

    const numberCheck = result.checks.find((check) => check.field === "inscription_number")
    expect(numberCheck).toBeDefined()
    expect(numberCheck?.sources_agree).toBe(true)
  })
})
