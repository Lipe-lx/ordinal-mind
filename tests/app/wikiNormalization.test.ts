import { describe, expect, it } from "vitest"
import { chooseCanonicalWikiValue, normalizeWikiValue } from "../../src/app/lib/wikiNormalization"

describe("wikiNormalization", () => {
  it("normalizes punctuation, case, accents, and whitespace", () => {
    expect(normalizeWikiValue("  Sátoshi!!   Rodarmor ")).toBe("satoshi rodarmor")
  })

  it("picks a deterministic canonical value", () => {
    const values = [
      "Satoshi",
      "Satoshi!!",
      "satoshi",
      "Sátoshi",
    ]

    expect(chooseCanonicalWikiValue(values)).toBe("Satoshi!!")
  })
})
