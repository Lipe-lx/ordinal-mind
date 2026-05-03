import { describe, expect, it } from "vitest"
import { parseWikiExtract, hasWikiExtract } from "../../src/app/lib/byok/wikiExtractor"

describe("wikiExtractor", () => {
  it("detects if text has a wiki_extract block", () => {
    expect(hasWikiExtract("some text <wiki_extract>{}</wiki_extract>")).toBe(true)
    expect(hasWikiExtract("no extract here")).toBe(false)
    expect(hasWikiExtract("<WIKI_EXTRACT>{}</WIKI_EXTRACT>")).toBe(true)
  })

  it("parses a valid wiki_extract block and cleans text", () => {
    const raw = `This is the answer.
<wiki_extract>
{
  "field": "founder",
  "value": "Satoshi",
  "confidence": "stated_by_user",
  "verifiable": true,
  "collection_slug": "bitcoin-core",
  "source_chat_excerpt": "I am satoshi"
}
</wiki_extract>`

    const result = parseWikiExtract(raw)
    expect(result.cleanText).toBe("This is the answer.")
    expect(result.data).toEqual({
      field: "founder",
      value: "Satoshi",
      confidence: "stated_by_user",
      verifiable: true,
      collection_slug: "bitcoin-core",
      source_chat_excerpt: "I am satoshi",
    })
  })

  it("returns null for malformed JSON but still cleans text", () => {
    const raw = `Answer <wiki_extract>{ invalid json }</wiki_extract>`
    const result = parseWikiExtract(raw)
    expect(result.cleanText).toBe("Answer")
    expect(result.data).toBeNull()
  })

  it("handles missing block gracefully", () => {
    const raw = `Just a plain answer`
    const result = parseWikiExtract(raw)
    expect(result.cleanText).toBe("Just a plain answer")
    expect(result.data).toBeNull()
  })

  it("returns null for invalid fields", () => {
    const raw = `Answer <wiki_extract>
    {
      "field": "unknown_field",
      "value": "val",
      "confidence": "inferred",
      "verifiable": false,
      "collection_slug": "slug"
    }
    </wiki_extract>`
    const result = parseWikiExtract(raw)
    expect(result.data).toBeNull()
  })

  it("returns null if confidence is invalid", () => {
    const raw = `Answer <wiki_extract>
    {
      "field": "founder",
      "value": "val",
      "confidence": "invalid_confidence",
      "verifiable": false,
      "collection_slug": "slug"
    }
    </wiki_extract>`
    const result = parseWikiExtract(raw)
    expect(result.data).toBeNull()
  })

  it("parses only the first block if multiple exist", () => {
    const raw = `Answer <wiki_extract>{"field":"founder","value":"A","confidence":"inferred","verifiable":false,"collection_slug":"slug"}</wiki_extract>
    <wiki_extract>{"field":"founder","value":"B","confidence":"inferred","verifiable":false,"collection_slug":"slug"}</wiki_extract>`
    
    const result = parseWikiExtract(raw)
    expect(result.data?.value).toBe("A")
  })
})
