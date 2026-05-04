import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { SearchToolDefinition } from "./tools"

export type ToolExposurePolicy = "none" | "narrow_factual" | "broad" | "wiki_builder"
export type GeminiFunctionCallingMode = "AUTO" | "ANY" | "NONE"

export interface ChatToolPolicyDecision {
  policy: ToolExposurePolicy
  allowedToolNames: string[]
  geminiMode: GeminiFunctionCallingMode
  reason: string
}

export function resolveChatToolPolicy(params: {
  prompt: string
  mode: ChatResponseMode
  intent: ChatIntent
}): ChatToolPolicyDecision {
  const normalized = normalize(params.prompt)

  if (params.intent === "knowledge_contribution") {
    return {
      policy: "wiki_builder",
      allowedToolNames: resolveKnowledgeContributionTools(),
      geminiMode: "AUTO",
      reason: "knowledge_contribution_verification",
    }
  }

  if (params.intent !== "chronicle_query") {
    return {
      policy: "none",
      allowedToolNames: [],
      geminiMode: "NONE",
      reason: "non_chronicle_intent",
    }
  }

  if (params.mode === "narrative") {
    return {
      policy: "broad",
      allowedToolNames: [],
      geminiMode: "AUTO",
      reason: "narrative_mode",
    }
  }

  const allowedToolNames = resolveNarrowFactTools(normalized)
  return {
    policy: "narrow_factual",
    allowedToolNames,
    geminiMode: allowedToolNames.length > 0 ? "ANY" : "NONE",
    reason: allowedToolNames.length > 0 ? "qa_narrow_factual" : "qa_without_tool_need",
  }
}

export function selectToolsForPolicy(
  tools: SearchToolDefinition[],
  decision: ChatToolPolicyDecision
): SearchToolDefinition[] {
  if (decision.policy === "none") return []
  if (decision.policy === "broad" || decision.allowedToolNames.length === 0) return tools

  const allowed = new Set(decision.allowedToolNames)
  return tools.filter((tool) => allowed.has(tool.name))
}

function resolveNarrowFactTools(prompt: string): string[] {
  if (isCollectionSizeQuestion(prompt)) {
    return ["get_collection_context"]
  }

  if (isTransferQuestion(prompt)) {
    return ["get_timeline", "get_raw_events"]
  }

  if (isGenesisOrParentQuestion(prompt)) {
    return ["get_timeline", "get_raw_events"]
  }

  return []
}

function resolveKnowledgeContributionTools(): string[] {
  return [
    "search_wiki",
    "get_collection_context",
    "get_timeline",
    "get_raw_events",
    "web_search",
    "deep_research",
    "synthesized_search",
  ]
}

function isCollectionSizeQuestion(prompt: string): boolean {
  return (
    /\b(how many|quant[ao]s?|supply|total)\b/u.test(prompt) &&
    /\b(collection|cole[cç][aã]o|runestone|items?|inscriptions?|inscri[cç][oõ]es?)\b/u.test(prompt)
  )
}

function isTransferQuestion(prompt: string): boolean {
  return /\b(transfer|transfers|transferencias|transferências|sold|sale|sales|vendeu|vendas|owner history)\b/u.test(prompt)
}

function isGenesisOrParentQuestion(prompt: string): boolean {
  return /\b(parent|parents|pai|mint|minted|mintada|mintado|genesis|cunhad[ao]|bloco|block)\b/u.test(prompt)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}
