import { afterEach, describe, expect, it, vi } from "vitest"
import { ToolExecutor } from "../../src/app/lib/byok/toolExecutor"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ToolExecutor", () => {
  it("deduplicates exact repeated wiki tool calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      collection_slug: "runestone",
      collection_size: 112383,
      collection_size_source: "raw_chronicle_events.genesis",
      source: "wiki_db",
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    vi.stubGlobal("fetch", fetchMock)

    const executor = new ToolExecutor({})
    const first = await executor.executeTool("get_collection_context", { collection_slug: "runestone" })
    const second = await executor.executeTool("get_collection_context", { collection_slug: "runestone" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.data?.collection_size).toBe(112383)
    expect(second.data?.collection_size).toBe(112383)
  })

  it("reuses a complete broader get_raw_events result for narrower event filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      inscription_id: "abc123i0",
      event_count: 2,
      events: [
        { id: "ev_transfer", event_type: "transfer", description: "Transferred" },
        { id: "ev_sale", event_type: "sale", description: "Sold" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    vi.stubGlobal("fetch", fetchMock)

    const executor = new ToolExecutor({})
    const broad = await executor.executeTool("get_raw_events", {
      inscription_id: "abc123i0",
      event_types: ["transfer", "sale"],
      limit: 10,
    })
    const narrow = await executor.executeTool("get_raw_events", {
      inscription_id: "abc123i0",
      event_types: ["sale"],
      limit: 10,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(broad.data?.event_count).toBe(2)
    expect(narrow.data?.event_count).toBe(1)
    expect(Array.isArray(narrow.data?.events)).toBe(true)
    expect((narrow.data?.events as Array<{ event_type: string }>)[0]?.event_type).toBe("sale")
  })
})
