import { describe, expect, it } from "vitest"
import { applyResponseGuardrails, resolvePolicyResponse } from "../../src/app/lib/byok/chatPolicies"

describe("chat policy responses", () => {
  it("returns local response for greeting", () => {
    const outcome = resolvePolicyResponse("greeting", "Oi")
    expect(outcome.handledLocally).toBe(true)
    expect(outcome.responseText?.length).toBeGreaterThan(20)
  })

  it("localizes local greeting responses using the latest user message language", () => {
    const outcome = resolvePolicyResponse("greeting", "¿Hola, puedes ayudarme?")
    expect(outcome.handledLocally).toBe(true)
    expect(outcome.responseText).toContain("Hola")
  })

  it("does not short-circuit factual query", () => {
    const outcome = resolvePolicyResponse("chronicle_query", "Quem é o owner?")
    expect(outcome.handledLocally).toBe(false)
  })
})

describe("chat guardrails", () => {
  it("trims non-factual responses to short style", () => {
    const text = "Tudo ótimo. Posso ajudar. E também posso fazer várias coisas detalhadas que não são necessárias aqui."
    const guarded = applyResponseGuardrails({
      text,
      intent: "smalltalk_social",
      mode: "qa",
    })

    expect(guarded.split(/[.!?]+/).filter(Boolean).length).toBeLessThanOrEqual(2)
  })

  it("limits chronicle qa verbosity", () => {
    const text = [
      "Parágrafo 1 sobre a coleção.",
      "Parágrafo 2 sobre provenance.",
      "Parágrafo 3 sobre transfers.",
      "Parágrafo 4 sobre mercado.",
    ].join("\n\n")

    const guarded = applyResponseGuardrails({
      text,
      intent: "chronicle_query",
      mode: "qa",
      previousAssistantText: "Parágrafo antigo sobre a coleção.",
    })

    const paragraphs = guarded.split(/\n\s*\n/).filter(Boolean)
    expect(paragraphs.length).toBeLessThanOrEqual(3)
  })

  it("forces direct answer plus optional one evidence for short factoid prompts", () => {
    const text = [
      "Leonidas lançou o projeto em 2024.",
      "A inscrição foi cunhada em 3 de março de 2024 no bloco 832947.",
      "Também houve diversas transferências posteriores com atividade de mercado.",
    ].join(" ")

    const guarded = applyResponseGuardrails({
      text,
      intent: "chronicle_query",
      mode: "qa",
      userPrompt: "o leonidas criou quando isso ?",
    })

    const sentences = guarded.split(/(?<=[.!?])\s+/).filter(Boolean)
    expect(sentences.length).toBeLessThanOrEqual(2)
  })
})
