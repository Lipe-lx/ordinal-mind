import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWikiPage, isWikiPageStale } from "../../src/app/lib/byok/wikiLifecycle"
import type { WikiPage } from "../../src/app/lib/wikiTypes"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("wikiLifecycle helpers", () => {
  it("detects stale wiki pages older than 7 days", () => {
    const page: WikiPage = {
      slug: "inscription:abc123i0",
      entity_type: "inscription",
      title: "#7",
      summary: "summary",
      sections: [],
      cross_refs: [],
      source_event_ids: ["ev1"],
      generated_at: "2026-04-01T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
      updated_at: "2026-04-01T00:00:00.000Z",
    }

    const now = Date.parse("2026-04-28T00:00:00.000Z")
    expect(isWikiPageStale(page, now)).toBe(true)
  })

  it("handles 404 fetch result as wiki_page_not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "wiki_page_not_found" }), { status: 404 })))

    const result = await fetchWikiPage("inscription:abc123i0")
    expect(result.page).toBeNull()
    expect(result.error).toBe("wiki_page_not_found")
  })

  it("parses successful wiki page response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      slug: "inscription:abc123i0",
      entity_type: "inscription",
      title: "#7",
      summary: "summary",
      sections: [],
      cross_refs: [],
      source_event_ids: ["ev1"],
      generated_at: "2026-04-28T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
    }), { status: 200 })))

    const result = await fetchWikiPage("inscription:abc123i0")
    expect(result.page?.slug).toBe("inscription:abc123i0")
    expect(result.error).toBeNull()
  })
})
