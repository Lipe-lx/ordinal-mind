import { afterEach, describe, expect, it, vi } from "vitest"
import { getCachedLintReport, isSlugFlaggedForRegeneration, maybeRunWikiLint, shouldRunLint } from "../../src/app/lib/wikiLint"
import type { WikiLintReport } from "../../src/app/lib/wikiTypes"

function mockWindow() {
  const store = new Map<string, string>()
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    },
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("wikiLint", () => {
  it("runs lint when no session timestamp exists", () => {
    mockWindow()
    expect(shouldRunLint(Date.parse("2026-04-28T00:00:00.000Z"))).toBe(true)
  })

  it("stores and reads lint report from session storage", async () => {
    mockWindow()

    const report: WikiLintReport = {
      run_at: "2026-04-28T00:00:00.000Z",
      unverified_pages: [{ slug: "inscription:abc", title: "A", unverified_count: 1 }],
      orphan_pages: [],
      stale_pages: [],
      broken_cross_refs: [],
      summary: { total: 1, healthy: 0, needs_attention: 1 },
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200 })))

    const result = await maybeRunWikiLint(Date.parse("2026-04-28T00:00:00.000Z"))
    expect(result?.summary.total).toBe(1)

    const cached = getCachedLintReport()
    expect(cached?.summary.needs_attention).toBe(1)
  })

  it("flags slug when stale or unverified", () => {
    const report: WikiLintReport = {
      run_at: "2026-04-28T00:00:00.000Z",
      unverified_pages: [{ slug: "inscription:abc", title: "A", unverified_count: 1 }],
      orphan_pages: [],
      stale_pages: [{ slug: "inscription:def", generated_at: "2026-03-01T00:00:00.000Z" }],
      broken_cross_refs: [],
      summary: { total: 2, healthy: 0, needs_attention: 2 },
    }

    expect(isSlugFlaggedForRegeneration("inscription:abc", report)).toBe(true)
    expect(isSlugFlaggedForRegeneration("inscription:def", report)).toBe(true)
    expect(isSlugFlaggedForRegeneration("inscription:xyz", report)).toBe(false)
  })
})
