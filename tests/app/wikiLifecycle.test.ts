import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchWikiHealth,
  fetchWikiPage,
  isWikiHealthReady,
  isWikiPageStale,
  shouldAttemptWikiRegeneration,
} from "../../src/app/lib/byok/wikiLifecycle"
import type { WikiHealth, WikiPage } from "../../src/app/lib/wikiTypes"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("wikiLifecycle helpers", () => {
  const readyHealth: WikiHealth = {
    ok: true,
    ready: true,
    status: "ready",
    present_objects: ["raw_chronicle_events", "wiki_pages", "wiki_log", "wiki_fts"],
    missing_objects: [],
    checked_at: "2026-04-28T00:00:00.000Z",
  }

  const missingHealth: WikiHealth = {
    ok: false,
    ready: false,
    status: "schema_missing",
    error: "wiki_schema_missing",
    phase: "fail_soft",
    present_objects: [],
    missing_objects: ["raw_chronicle_events", "wiki_pages", "wiki_log", "wiki_fts"],
    checked_at: "2026-04-28T00:00:00.000Z",
  }

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

  it("parses wiki health and detects uninitialized schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(missingHealth), { status: 503 })))

    const health = await fetchWikiHealth()

    expect(health.status).toBe("schema_missing")
    expect(isWikiHealthReady(health)).toBe(false)
  })

  it("prevents BYOK wiki regeneration when D1 schema is not ready", () => {
    const shouldRegenerate = shouldAttemptWikiRegeneration({
      health: missingHealth,
      canGenerate: true,
      page: null,
      fetchError: "wiki_page_not_found",
    })

    expect(shouldRegenerate).toBe(false)
  })

  it("allows BYOK wiki regeneration for missing pages only when wiki health is ready", () => {
    const shouldRegenerate = shouldAttemptWikiRegeneration({
      health: readyHealth,
      canGenerate: true,
      page: null,
      fetchError: "wiki_page_not_found",
    })

    expect(shouldRegenerate).toBe(true)
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
