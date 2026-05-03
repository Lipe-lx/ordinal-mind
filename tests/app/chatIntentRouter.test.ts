import { describe, expect, it } from "vitest"
import { routeChatIntent } from "../../src/app/lib/byok/chatIntentRouter"
import type { ChatMessage } from "../../src/app/lib/byok/chatTypes"

describe("chat intent router", () => {
  const history: ChatMessage[] = [
    {
      id: "a1",
      role: "assistant",
      content: "Resumo inicial da chronicle.",
      createdAt: "2024-01-01T00:00:00.000Z",
      turnId: "t1",
    },
  ]

  it("classifies greetings as greeting", () => {
    const decision = routeChatIntent("Oi", history)
    expect(decision.intent).toBe("greeting")
    expect(decision.mode).toBe("qa")
  })

  it("classifies social smalltalk", () => {
    const decision = routeChatIntent("Tudo bom?", history)
    expect(decision.intent).toBe("smalltalk_social")
  })

  it("classifies conversational check-ins as smalltalk", () => {
    const decision = routeChatIntent("como estao as coisas ai hoje?", history)
    expect(decision.intent).toBe("smalltalk_social")
  })

  it("classifies factual question as chronicle_query", () => {
    const decision = routeChatIntent("Quem é o owner atual dessa inscrição?", history)
    expect(decision.intent).toBe("chronicle_query")
  })

  it("classifies parent follow-ups as chronicle_query", () => {
    const decision = routeChatIntent("falo da parent", history)
    expect(decision.intent).toBe("chronicle_query")
    expect(decision.mode).toBe("qa")
  })

  it("classifies parent mint-date corrections as chronicle_query", () => {
    const decision = routeChatIntent("me fale a data que a inscrição parent dessa foi cunhada", history)
    expect(decision.intent).toBe("chronicle_query")
    expect(decision.mode).toBe("qa")
  })

  it("uses qa mode for first-turn factual question in a fresh session", () => {
    const decision = routeChatIntent("o leonidas criou quando isso ?", [])
    expect(decision.intent).toBe("chronicle_query")
    expect(decision.mode).toBe("qa")
  })

  it("routes recap request to narrative mode", () => {
    const decision = routeChatIntent("Pode fazer um resumo narrativo completo?", history)
    expect(decision.intent).toBe("chronicle_query")
    expect(decision.mode).toBe("narrative")
  })

  it("classifies off-topic safely", () => {
    const decision = routeChatIntent("como está o tempo hoje?", history)
    expect(decision.intent).toBe("offtopic_safe")
  })

  it("classifies knowledge_contribution for valid first-person collection statements", () => {
    const decision = routeChatIntent("eu estava lá quando a coleção mintou", history)
    expect(decision.intent).toBe("knowledge_contribution")
  })

  it("classifies knowledge_contribution for founder statements", () => {
    const decision = routeChatIntent("o fundador dessa coleção é o fulano", history)
    expect(decision.intent).toBe("knowledge_contribution")
  })

  it("classifies knowledge_contribution for supply correction", () => {
    const decision = routeChatIntent("na verdade o supply total é 10000 satoshis", history)
    expect(decision.intent).toBe("knowledge_contribution")
  })

  it("does not classify as knowledge_contribution if no chronicle context is present", () => {
    // "eu comprei um café" has a first-person pattern ("eu comprei") but no chronicle hint
    const decision = routeChatIntent("eu comprei um café hoje cedo", history)
    expect(decision.intent).not.toBe("knowledge_contribution")
  })
})
