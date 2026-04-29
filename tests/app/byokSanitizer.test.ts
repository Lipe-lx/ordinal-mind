import { describe, expect, it } from "vitest"
import { sanitizeNarrative, sanitizeNarrativePreview } from "../../src/app/lib/byok/sanitizer"

describe("BYOK sanitizer", () => {
  it("prefers the explicit final answer block over surrounding reasoning", () => {
    const raw = `User Question: "quatans runestone existem?"
Target Entity: The Runestone collection.
Language: Portuguese.
<final_answer>
A coleção Runestone aparece com supply de 112.4K na Satflow.
</final_answer>`

    expect(sanitizeNarrative(raw)).toBe(
      "A coleção Runestone aparece com supply de 112.4K na Satflow."
    )
  })

  it("streams only content after an open final answer tag", () => {
    const raw = `User Question: "quatans runestone existem?"
<final_answer>A coleção Runestone aparece`

    expect(sanitizeNarrativePreview(raw)).toBe("A coleção Runestone aparece")
  })

  it("hides reasoning before the final answer tag and accepts an unclosed final block", () => {
    const raw = "`. * Directness: High.\n\n*Refining the answer:*\nExistem aproximadamente 112.400 Runestones na coleção.<final_answer>Existem aproximadamente 112.400 Runestones. A distribuição foi planejada como airdrop para 112.383 carteiras."

    expect(sanitizeNarrativePreview("`. * Directness: High.\n\n*Refining the answer:*")).toBe("")
    expect(sanitizeNarrative(raw)).toBe(
      "Existem aproximadamente 112.400 Runestones. A distribuição foi planejada como airdrop para 112.383 carteiras."
    )
  })

  it("ignores literal placeholder final answer blocks and recovers from factual analysis", () => {
    const raw = `User Question: "quatans runestone existem?" (How many runestones exist?)

Target Entity: The Runestone collection.
Language: Portuguese.
Collection Name: Runestone
Supply (Satflow): 112.4K

<final_answer>
...
</final_answer>`

    expect(sanitizeNarrative(raw)).toBe(
      "A coleção Runestone aparece com supply de 112.4K na Satflow."
    )
    expect(sanitizeNarrativePreview(raw)).toBe("")
  })

  it("rejects connector-only final answers", () => {
    expect(sanitizeNarrative("<final_answer>and</final_answer>")).toBe("")
    expect(sanitizeNarrativePreview("<final_answer>and</final_answer>")).toBe("")
  })

  it("recovers a substantive draft when the final block is only a connector", () => {
    const raw = `Directness: High.
*Refining the answer:*
Existem aproximadamente 112.400 Runestones na coleção. A distribuição foi planejada como um airdrop para 112.383 carteiras.
<final_answer>and</final_answer>`

    expect(sanitizeNarrative(raw)).toBe(
      "Existem aproximadamente 112.400 Runestones na coleção. A distribuição foi planejada como um airdrop para 112.383 carteiras."
    )
  })

  it("removes Gemma-style source checks and keeps the direct answer", () => {
    const raw = `User Question: "quantas runas existem?" (How many Runes are there?)
Context: The user is asking about "Runes" in the context of the "Runestone" collection/protocol. * Source Data Check:
The provided data is about the Runestone collection (an Ordinals collection). * The Runes protocol is mentioned: "The collection was publicly framed around a future Runes token claim timed with the Runes protocol launch near the April 2024 halving."
Does the data specify the total supply of Runes (the protocol/tokens)? No. It specifies the supply of the Runestone collection (112.4K).`

    expect(sanitizeNarrative(raw)).toBe(
      "No. It specifies the supply of the Runestone collection (112.4K)."
    )
  })

  it("waits for the final answer block before showing streaming preview", () => {
    const raw = `<think>I should inspect the data first.</think>
Answer: A coleção tem 112.4K Runestones nos dados disponíveis.`

    expect(sanitizeNarrativePreview(raw)).toBe("")
    expect(sanitizeNarrative(raw)).toBe(
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

  it("turns Gemma structured supply analysis into a direct Portuguese answer", () => {
    const raw = `User Question: "quatans runestone existem?" (How many runestones exist?)

Target Entity: The Runestone collection.
Context: The user has been asking about "runas" (Runes) and now "runestone".
Language: Portuguese.
Collection Name: Runestone

Supply (Satflow): 112.4K (specifically "supply 112.4K")
Distribution Design: "Designed as an airdrop to 112,383 wallets"`

    expect(sanitizeNarrative(raw)).toBe(
      "A coleção Runestone aparece com supply de 112.4K na Satflow. O desenho de distribuição menciona airdrop para 112,383 wallets."
    )
  })
})
