import { describe, expect, it } from "vitest"
import {
  resolveAssistantDisplayText,
  resolveWikiContributionActivityStatus,
  resolveWikiToolActivityStatus,
} from "../../src/app/lib/byok/useChronicleNarrativeChat"

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

  it("localizes the wiki contribution fallback beyond Portuguese and English", () => {
    const result = resolveAssistantDisplayText({
      cleanText: "",
      intent: "knowledge_contribution",
      hasExtractedWiki: true,
      prompt: "¿El fundador de esta colección fue Casey Rodarmor?",
    })

    expect(result).toContain("contribución de la comunidad")
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

  it("describes wiki reads from tool activity", () => {
    const result = resolveWikiToolActivityStatus({
      tool: "get_collection_context",
      status: "running",
    })

    expect(result).toEqual({
      state: "reading",
      label: "Loading collection context from the wiki...",
    })
  })

  it("describes wiki writes for extracted contributions", () => {
    const result = resolveWikiContributionActivityStatus({
      phase: "done",
      field: "launch_date",
    })

    expect(result).toEqual({
      state: "success",
      label: "Wiki contribution for launch date was recorded.",
    })
  })
})
