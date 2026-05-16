import { describe, expect, it } from "vitest"
import { shouldCreateFreshAutoNarrativeThread } from "../../src/app/lib/byok/useChronicleNarrativeChat"

describe("useChronicleNarrativeChat bootstrap guards", () => {
  it("creates a fresh auto-narrative thread when the current thread already has messages", () => {
    expect(
      shouldCreateFreshAutoNarrativeThread({
        messages: [{ id: "m1" }],
        skipAutoNarrative: false,
      })
    ).toBe(true)
  })

  it("creates a fresh auto-narrative thread when the current thread is empty but skipAutoNarrative is set", () => {
    expect(
      shouldCreateFreshAutoNarrativeThread({
        messages: [],
        skipAutoNarrative: true,
      })
    ).toBe(true)
  })

  it("reuses the current thread when it is empty and auto narrative is still allowed", () => {
    expect(
      shouldCreateFreshAutoNarrativeThread({
        messages: [],
        skipAutoNarrative: false,
      })
    ).toBe(false)
  })

  it("does not force a fresh thread when there is no current snapshot", () => {
    expect(shouldCreateFreshAutoNarrativeThread(null)).toBe(false)
  })
})
