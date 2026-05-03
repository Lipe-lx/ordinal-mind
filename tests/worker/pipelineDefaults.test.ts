import { describe, it, expect } from "vitest"
import {
  emptyCollectorSignals,
  fallbackCollectionData,
  emptyUnisatEnrichment,
} from "../../src/worker/pipeline/defaults"
import type { InscriptionMeta } from "../../src/app/lib/types"

describe("pipeline defaults", () => {
  it("should return a complete emptyCollectorSignals object", () => {
    const signals = emptyCollectorSignals()
    expect(signals.attention_score).toBe(0)
    expect(signals.sentiment_label).toBe("insufficient_data")
    expect(signals.provider_breakdown).toHaveProperty("google_trends")
    expect(signals.windows.current_7d).toBeDefined()
  })

  it("should return a complete fallbackCollectionData object", () => {
    const meta: InscriptionMeta = {
      inscription_id: "testi0",
      inscription_number: 1,
      sat: 1,
      sat_rarity: "common",
      content_type: "image/png",
      content_url: "url",
      genesis_block: 1,
      genesis_timestamp: "time",
      genesis_fee: 1,
      owner_address: "addr",
      genesis_txid: "tx",
      genesis_vout: 0,
    }
    const data = fallbackCollectionData(meta)
    expect(data.mediaContext.preview_url).toContain("testi0")
    expect(data.collectionContext.protocol.parents).toBeNull()
    expect(data.sourceCatalog).toEqual([])
  })

  it("should return a correct emptyUnisatEnrichment object", () => {
    const enrichment = emptyUnisatEnrichment("testi0", null, null)
    expect(enrichment.inscription_info).toBeNull()
    expect(enrichment.source_catalog).toEqual([])

    const withInfo = emptyUnisatEnrichment(
      "testi0",
      { charms: [], sat: 1, metaprotocol: null, content_length: 100 },
      null
    )
    expect(withInfo.inscription_info).not.toBeNull()
    expect(withInfo.source_catalog.length).toBe(1)
    expect(withInfo.source_catalog[0].source_type).toBe(
      "unisat_inscription_info"
    )
  })
})
