import { describe, it, expect } from "vitest"
import { buildTimeline } from "../../src/worker/timeline"
import type { InscriptionMeta } from "../../src/app/lib/types"
import type { OrdinalsMetadata } from "../../src/worker/agents/ordinals"
import type { XMention } from "../../src/worker/agents/xsearch"

const baseMeta: InscriptionMeta = {
  inscription_id: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1i0",
  inscription_number: 1000,
  sat: 1234567890,
  sat_rarity: "uncommon",
  content_type: "image/png",
  content_url: "https://example.com/content",
  genesis_block: 800000,
  genesis_timestamp: "2023-07-15T10:00:00.000Z",
  genesis_fee: 5000,
  owner_address: "bc1pabcdef1234567890abcdef1234567890abcdef1234567890",
}

describe("buildTimeline", () => {
  describe("genesis event", () => {
    it("should always produce a genesis event", () => {
      const events = buildTimeline(baseMeta, [], null, [])
      const genesis = events.find((e) => e.event_type === "genesis")

      expect(genesis).toBeDefined()
      expect(genesis!.timestamp).toBe(baseMeta.genesis_timestamp)
      expect(genesis!.block_height).toBe(baseMeta.genesis_block)
      expect(genesis!.source.type).toBe("onchain")
    })
  })

  describe("sat context", () => {
    it("should include sat_context for non-common rarity", () => {
      const events = buildTimeline(baseMeta, [], null, [])
      const satCtx = events.find((e) => e.event_type === "sat_context")

      expect(satCtx).toBeDefined()
      expect(satCtx!.description).toContain("uncommon")
    })

    it("should NOT include sat_context for common rarity", () => {
      const commonMeta = { ...baseMeta, sat_rarity: "common" as const }
      const events = buildTimeline(commonMeta, [], null, [])
      const satCtx = events.find((e) => e.event_type === "sat_context")

      expect(satCtx).toBeUndefined()
    })
  })

  describe("collection link", () => {
    it("should include collection_link when collection exists", () => {
      const metaWithCollection = {
        ...baseMeta,
        collection: { parent_inscription_id: "parent123i0", name: "Cool Collection" },
      }
      const events = buildTimeline(metaWithCollection, [], null, [])
      const colLink = events.find((e) => e.event_type === "collection_link")

      expect(colLink).toBeDefined()
      expect(colLink!.description).toContain("Cool Collection")
    })

    it("should NOT include collection_link when no collection", () => {
      const events = buildTimeline(baseMeta, [], null, [])
      const colLink = events.find((e) => e.event_type === "collection_link")

      expect(colLink).toBeUndefined()
    })
  })

  describe("transfers", () => {
    it("should create transfer events", () => {
      const transfers = [
        {
          tx_id: "tx1",
          from_address: "addr_from_1",
          to_address: "addr_to_1",
          confirmed_at: "2023-08-01T00:00:00.000Z",
        },
      ]
      const events = buildTimeline(baseMeta, transfers, null, [])
      const transfer = events.find((e) => e.event_type === "transfer")

      expect(transfer).toBeDefined()
      expect(transfer!.source.ref).toBe("tx1")
    })

    it("should classify as sale when value > 0", () => {
      const transfers = [
        {
          tx_id: "tx_sale",
          from_address: "seller",
          to_address: "buyer",
          confirmed_at: "2023-09-01T00:00:00.000Z",
          value: 100000,
        },
      ]
      const events = buildTimeline(baseMeta, transfers, null, [])
      const sale = events.find((e) => e.event_type === "sale")

      expect(sale).toBeDefined()
      expect(sale!.description).toContain("BTC")
    })
  })

  describe("x mentions", () => {
    it("should create x_mention events", () => {
      const mentions: XMention[] = [
        {
          url: "https://x.com/user/status/123",
          title: "Check out this inscription!",
          snippet: "Amazing ordinal art",
          found_at: "2024-01-15T12:00:00.000Z",
        },
      ]
      const events = buildTimeline(baseMeta, [], null, mentions)
      const xEvent = events.find((e) => e.event_type === "x_mention")

      expect(xEvent).toBeDefined()
      expect(xEvent!.source.type).toBe("web")
      expect(xEvent!.source.ref).toBe("https://x.com/user/status/123")
    })
  })

  describe("recursive refs", () => {
    it("should create recursive_ref events", () => {
      const ordData: OrdinalsMetadata = {
        references: ["ref1i0", "ref2i0"],
      }
      const events = buildTimeline(baseMeta, [], ordData, [])
      const refs = events.filter((e) => e.event_type === "recursive_ref")

      expect(refs).toHaveLength(2)
    })
  })

  describe("chronological sorting", () => {
    it("should sort events chronologically", () => {
      const transfers = [
        {
          tx_id: "tx_later",
          from_address: "a",
          to_address: "b",
          confirmed_at: "2024-06-01T00:00:00.000Z",
        },
        {
          tx_id: "tx_earlier",
          from_address: "c",
          to_address: "d",
          confirmed_at: "2023-12-01T00:00:00.000Z",
        },
      ]
      const events = buildTimeline(baseMeta, transfers, null, [])

      // Genesis should be first (earliest timestamp)
      expect(events[0].event_type).toBe("genesis")

      // Find the transfer events and verify order
      const transferEvents = events.filter(
        (e) => e.event_type === "transfer" || e.event_type === "sale"
      )
      const firstTransferTime = new Date(transferEvents[0].timestamp).getTime()
      const secondTransferTime = new Date(transferEvents[1].timestamp).getTime()
      expect(firstTransferTime).toBeLessThanOrEqual(secondTransferTime)
    })

    it("should put events without timestamps at the end", () => {
      const transfers = [
        {
          tx_id: "tx_no_time",
          from_address: "a",
          to_address: "b",
          confirmed_at: null,
        },
      ]
      const events = buildTimeline(baseMeta, transfers, null, [])
      const lastEvent = events[events.length - 1]

      expect(lastEvent.event_type).toBe("transfer")
      expect(lastEvent.timestamp).toBe(new Date(0).toISOString())
    })
  })

  describe("determinism", () => {
    it("should produce same output for same input", () => {
      const transfers = [
        {
          tx_id: "tx1",
          from_address: "a",
          to_address: "b",
          confirmed_at: "2024-01-01T00:00:00.000Z",
        },
      ]
      const mentions: XMention[] = [
        {
          url: "https://x.com/test",
          title: "Test",
          snippet: "Test snippet",
          found_at: "2024-02-01T00:00:00.000Z",
        },
      ]

      const events1 = buildTimeline(baseMeta, transfers, null, mentions)
      const events2 = buildTimeline(baseMeta, transfers, null, mentions)

      expect(events1.length).toBe(events2.length)
      for (let i = 0; i < events1.length; i++) {
        expect(events1[i].event_type).toBe(events2[i].event_type)
        expect(events1[i].timestamp).toBe(events2[i].timestamp)
        expect(events1[i].description).toBe(events2[i].description)
      }
    })
  })

  describe("empty sources", () => {
    it("should handle all empty sources gracefully", () => {
      const events = buildTimeline(
        { ...baseMeta, sat_rarity: "common" },
        [],
        null,
        []
      )
      // Should still have genesis
      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].event_type).toBe("genesis")
    })
  })
})
