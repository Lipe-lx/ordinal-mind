import { describe, expect, it } from "vitest"
import { resolveWikiBuilderTarget } from "../../src/app/pages/WikiPage"

describe("WikiPage builder routing", () => {
  it("prefers the explicit from context when opening the builder", () => {
    const target = resolveWikiBuilderTarget({
      currentSearch: "?from=inscription-ref-1",
      currentSlug: "collection:runestone",
      sampleInscriptionId: "sample-ref-2",
    })

    expect(target).toBe("/chronicle/inscription-ref-1")
  })

  it("falls back to sample inscription id when no from context exists", () => {
    const target = resolveWikiBuilderTarget({
      currentSearch: "",
      currentSlug: "runestone",
      sampleInscriptionId: "sample-ref-2",
    })

    expect(target).toBe("/chronicle/sample-ref-2")
  })

  it("returns null when no chronicle reference can be resolved", () => {
    const target = resolveWikiBuilderTarget({
      currentSearch: "",
      currentSlug: "runestone",
      sampleInscriptionId: null,
    })

    expect(target).toBeNull()
  })
})
