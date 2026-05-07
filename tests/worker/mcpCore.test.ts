import { describe, expect, it } from "vitest"
import { toCapabilityMap } from "../../src/worker/mcp/types"
import {
  MCP_LIMITS,
  guardProvenanceDepth,
  serializeGuardedResource,
} from "../../src/worker/mcp/guards"
import { isMcpEnabled, isTrustedMcpOrigin } from "../../src/worker/mcp"
import type { ChronicleEvent } from "../../src/app/lib/types"

function buildEvent(index: number): ChronicleEvent {
  return {
    id: `evt_${index}`,
    timestamp: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    block_height: 840000 + index,
    event_type: "transfer",
    source: {
      type: "onchain",
      ref: `txid-${index}`,
    },
    description: "Transfer",
    metadata: {},
  }
}

describe("MCP capabilities", () => {
  it("maps tiers into expected capability gates", () => {
    expect(toCapabilityMap("anon")).toEqual({
      canContributeWiki: false,
      canReviewContribution: false,
      canRefreshChronicle: false,
      canReindexCollection: false,
    })

    expect(toCapabilityMap("community")).toEqual({
      canContributeWiki: true,
      canReviewContribution: false,
      canRefreshChronicle: false,
      canReindexCollection: false,
    })

    expect(toCapabilityMap("genesis")).toEqual({
      canContributeWiki: true,
      canReviewContribution: true,
      canRefreshChronicle: true,
      canReindexCollection: true,
    })
  })
})

describe("MCP guards", () => {
  it("caps provenance depth", () => {
    const events = Array.from({ length: MCP_LIMITS.MAX_PROVENANCE_DEPTH + 15 }, (_, idx) => buildEvent(idx))
    const guarded = guardProvenanceDepth(events)
    expect(guarded).toHaveLength(MCP_LIMITS.MAX_PROVENANCE_DEPTH)
  })

  it("replaces oversized payload with explicit error object", () => {
    const huge = {
      ok: true,
      text: "x".repeat((MCP_LIMITS.MAX_RESOURCE_SIZE_KB * 1024) + 1200),
    }

    const serialized = serializeGuardedResource(huge)
    const parsed = JSON.parse(serialized) as Record<string, unknown>

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe("resource_payload_too_large")
  })
})

describe("MCP route flags and origin hardening", () => {
  it("honors MCP_ENABLED feature flag", () => {
    expect(isMcpEnabled({ MCP_ENABLED: "1" } as never)).toBe(true)
    expect(isMcpEnabled({ MCP_ENABLED: "0" } as never)).toBe(false)
    expect(isMcpEnabled({} as never)).toBe(false)
  })

  it("accepts trusted origins and blocks unknown origins", () => {
    const trustedReq = new Request("https://ordinalmind.com/mcp", {
      headers: {
        Origin: "https://ordinalmind.com",
      },
    })

    const blockedReq = new Request("https://ordinalmind.com/mcp", {
      headers: {
        Origin: "https://evil.example",
      },
    })

    expect(isTrustedMcpOrigin(trustedReq, "https://ordinalmind.com")).toBe(true)
    expect(isTrustedMcpOrigin(blockedReq, "https://ordinalmind.com")).toBe(false)
  })
})
