import { describe, expect, it } from "vitest"
import { resolveAssistantDisplayText } from "../../src/app/lib/byok/useChronicleNarrativeChat"

describe("useChronicleNarrativeChat display fallback", () => {
  it("keeps sanitized text when available", () => {
    const result = resolveAssistantDisplayText({
      cleanText: "Resposta limpa.",
      intent: "knowledge_contribution",
      hasExtractedWiki: true,
      prompt: "o fundador dessa coleção é o Casey",
    })

    expect(result).toBe("Resposta limpa.")
  })

  it("uses a safe fallback for wiki contributions when the model omits final_answer", () => {
    const result = resolveAssistantDisplayText({
      cleanText: "",
      intent: "knowledge_contribution",
      hasExtractedWiki: true,
      prompt: "o fundador dessa coleção é o Casey",
    })

    expect(result).toContain("contribuição da comunidade para a wiki")
  })

  it("does not fall back to raw text for non-contribution turns", () => {
    const result = resolveAssistantDisplayText({
      cleanText: "",
      intent: "chronicle_query",
      hasExtractedWiki: false,
      prompt: "quem é o dono atual?",
    })

    expect(result).toBe("")
  })
})
