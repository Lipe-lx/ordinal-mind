import { describe, expect, it } from "vitest"
import { resolveChatToolPolicy, selectToolsForPolicy } from "../../src/app/lib/byok/toolPolicy"
import { COLLECTION_RESEARCH_TOOLS } from "../../src/app/lib/byok/tools"

describe("chat tool policy", () => {
  it("narrows short factual collection-size questions to collection context only", () => {
    const decision = resolveChatToolPolicy({
      prompt: "Quantas Runestone existem?",
      mode: "qa",
      intent: "chronicle_query",
    })

    expect(decision.policy).toBe("narrow_factual")
    expect(decision.geminiMode).toBe("ANY")
    expect(decision.allowedToolNames).toEqual(["get_collection_context"])

    const tools = selectToolsForPolicy(COLLECTION_RESEARCH_TOOLS, decision)
    expect(tools.map((tool) => tool.name)).toEqual(["get_collection_context"])
  })

  it("keeps broad research tools for narrative turns", () => {
    const decision = resolveChatToolPolicy({
      prompt: "Me dê a narrativa completa da coleção",
      mode: "narrative",
      intent: "chronicle_query",
    })

    expect(decision.policy).toBe("broad")
    const tools = selectToolsForPolicy(COLLECTION_RESEARCH_TOOLS, decision)
    expect(tools.some((tool) => tool.name === "web_search")).toBe(true)
    expect(tools.some((tool) => tool.name === "get_collection_context")).toBe(true)
  })

  it("exposes verification tools for knowledge contributions", () => {
    const decision = resolveChatToolPolicy({
      prompt: "O fundador dessa coleção foi o Casey Rodarmor",
      mode: "qa",
      intent: "knowledge_contribution",
    })

    expect(decision.policy).toBe("wiki_builder")
    expect(decision.geminiMode).toBe("AUTO")
    expect(decision.allowedToolNames).toEqual([
      "search_wiki",
      "get_collection_context",
      "get_timeline",
      "get_raw_events",
      "web_search",
      "deep_research",
      "synthesized_search",
    ])

    const tools = selectToolsForPolicy(COLLECTION_RESEARCH_TOOLS, decision)
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_wiki",
      "get_raw_events",
      "get_timeline",
      "get_collection_context",
      "web_search",
      "deep_research",
      "synthesized_search",
    ])
  })
})
