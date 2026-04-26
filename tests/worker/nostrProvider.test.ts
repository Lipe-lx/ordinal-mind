import { describe, expect, it, vi } from "vitest"
import { buildMentionQueries } from "../../src/worker/agents/mentions/queryBuilder"
import { searchNostr } from "../../src/worker/agents/mentions/nostr"
import { createProviderDebug } from "../../src/worker/agents/mentions/types"

class MockWebSocket {
  private listeners = new Map<string, Array<(event?: MessageEvent) => void>>()
  url: string

  constructor(url: string) {
    this.url = url
    queueMicrotask(() => this.emit("open"))
  }

  addEventListener(type: string, listener: (event?: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  send(message: string) {
    const payload = JSON.parse(message) as [string, string, { search: string }]
    const subscriptionId = payload[1]
    const search = payload[2].search
    queueMicrotask(() => {
      this.emit("message", {
        data: JSON.stringify([
          "EVENT",
          subscriptionId,
          {
            id: `${search}-event`,
            pubkey: "f".repeat(64),
            created_at: 1714000000,
            content: `Bitcoin Puppets are legendary ${search}`,
            tags: [],
          },
        ]),
      } as MessageEvent)
      this.emit("message", {
        data: JSON.stringify(["EOSE", subscriptionId]),
      } as MessageEvent)
    })
  }

  close() {
    this.emit("close")
  }

  private emit(type: string, event?: MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

describe("searchNostr", () => {
  it("collects normalized mentions from NIP-50 relays", async () => {
    const queries = buildMentionQueries({
      inscriptionId: `${"a".repeat(64)}i0`,
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
    }).slice(0, 2)

    const diagnostics = createProviderDebug("nostr", {
      inscriptionId: `${"a".repeat(64)}i0`,
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
    }, queries)

    const result = await searchNostr(
      {
        inscriptionId: `${"a".repeat(64)}i0`,
        inscriptionNumber: 2971,
        collectionName: "Bitcoin Puppets",
        itemName: "Bitcoin Puppet #2971",
        queries,
        diagnostics,
      },
      {
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ supported_nips: [50] }), { status: 200 })),
        webSocketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
      }
    )

    expect(result.mentions.length).toBeGreaterThan(0)
    expect(result.mentions[0].platform).toBe("nostr")
    expect(result.mentions[0].canonical_url).toContain("njump.me")
    expect(diagnostics.attempts.some((attempt) => attempt.outcome === "query_completed")).toBe(true)
  })

  it("skips relays that do not advertise NIP-50", async () => {
    const queries = buildMentionQueries({
      inscriptionId: `${"a".repeat(64)}i0`,
      collectionName: "Bitcoin Puppets",
    }).slice(0, 1)

    const diagnostics = createProviderDebug("nostr", {
      inscriptionId: `${"a".repeat(64)}i0`,
      collectionName: "Bitcoin Puppets",
    }, queries)

    const result = await searchNostr(
      {
        inscriptionId: `${"a".repeat(64)}i0`,
        collectionName: "Bitcoin Puppets",
        queries,
        diagnostics,
      },
      {
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({ supported_nips: [1, 11] }), { status: 200 })),
        webSocketFactory: () => {
          throw new Error("websocket should not be opened")
        },
      }
    )

    expect(result.mentions).toEqual([])
    expect(diagnostics.attempts.some((attempt) => attempt.outcome === "unsupported")).toBe(true)
  })
})
