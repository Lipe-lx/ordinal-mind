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
})
