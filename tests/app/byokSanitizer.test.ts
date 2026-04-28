import { describe, expect, it } from "vitest"
import { sanitizeNarrative, sanitizeNarrativePreview } from "../../src/app/lib/byok/sanitizer"

describe("BYOK sanitizer", () => {
  it("removes Gemma-style source checks and keeps the direct answer", () => {
    const raw = `User Question: "quantas runas existem?" (How many Runes are there?)
Context: The user is asking about "Runes" in the context of the "Runestone" collection/protocol. * Source Data Check:
The provided data is about the Runestone collection (an Ordinals collection). * The Runes protocol is mentioned: "The collection was publicly framed around a future Runes token claim timed with the Runes protocol launch near the April 2024 halving."
Does the data specify the total supply of Runes (the protocol/tokens)? No. It specifies the supply of the Runestone collection (112.4K).`

    expect(sanitizeNarrative(raw)).toBe(
      "No. It specifies the supply of the Runestone collection (112.4K)."
    )
  })

  it("strips thinking tags from streaming preview", () => {
    const raw = `<think>I should inspect the data first.</think>
Answer: A coleção tem 112.4K Runestones nos dados disponíveis.`

    expect(sanitizeNarrativePreview(raw)).toBe(
      "A coleção tem 112.4K Runestones nos dados disponíveis."
    )
  })

  it("does not treat language checks as the final answer", () => {
    const raw = `User Question: "quantas runas existem?"
Is the user asking in Portuguese? Yes (Portuguese).
Does the provided data specify the total supply of Runes? No. Os dados disponíveis informam apenas o supply da coleção Runestone: 112.4K.`

    expect(sanitizeNarrative(raw)).toBe(
      "No. Os dados disponíveis informam apenas o supply da coleção Runestone: 112.4K."
    )
  })
})
