import type { ChatIntent, ChatIntentDecision, ChatResponseMode } from "./chatIntentRouter"

export const CHAT_INTENT_ROUTER_V1 = true

export type IntentRouterMode = "off" | "shadow" | "active"

export function getIntentRouterMode(): IntentRouterMode {
  if (!CHAT_INTENT_ROUTER_V1) return "off"
  if (typeof window === "undefined") return "active"

  const override = window.localStorage.getItem("ordinal-mind_intent_router_mode")
  if (override === "off" || override === "shadow" || override === "active") {
    return override
  }

  return "active"
}

export interface PolicyOutcome {
  handledLocally: boolean
  responseText?: string
}

export function resolvePolicyResponse(intent: ChatIntent, _input: string): PolicyOutcome {
  switch (intent) {
    case "greeting":
      return {
        handledLocally: true,
        responseText: "Hi. I can help with this Chronicle, whether you want a short overview or a specific answer about provenance, transfers, parent links, or collection context.",
      }
    case "smalltalk_social":
      return {
        handledLocally: true,
        responseText: "All good here. I can stay focused on this inscription and help with its current owner, recent transfers, parent links, or unresolved details.",
      }
    case "acknowledgement":
      return {
        handledLocally: true,
        responseText: "Got it. Ask the next question about this inscription and I will answer from the available Chronicle data.",
      }
    case "clarification_request":
      return {
        handledLocally: true,
        responseText: "I can explain. Tell me which part you mean: overview, on-chain provenance, parent links, transfer history, or collection signals.",
      }
    case "offtopic_safe":
      return {
        handledLocally: true,
        responseText: "I should stay focused on this inscription's Chronicle. I can answer about provenance, current owner, transfers, parent links, or collection context.",
      }
    case "knowledge_contribution":
      // Handled by LLM via prompt mode (Wiki Builder Mode)
      return { handledLocally: false }
    case "chronicle_query":
    default:
      return { handledLocally: false }
  }
}

export function applyResponseGuardrails(params: {
  text: string
  intent: ChatIntent
  mode: ChatResponseMode
  previousAssistantText?: string
  userPrompt?: string
}): string {
  const { intent, mode, previousAssistantText, userPrompt } = params
  let text = params.text.trim()

  if (!text) return text

  if (intent !== "chronicle_query") {
    return toSentenceLimit(text, 2)
  }

  if (mode === "qa") {
    text = trimParagraphs(text, 2)
    text = trimIfRepeated(text, previousAssistantText, 0.72)
    text = toSentenceLimit(text, 5)
    if (isShortFactoidPrompt(userPrompt)) {
      text = toDirectAnswerWithOneEvidence(text)
    }
    return text
  }

  text = trimParagraphs(text, 5)
  text = trimIfRepeated(text, previousAssistantText, 0.78)
  return text
}

function isShortFactoidPrompt(prompt: string | undefined): boolean {
  if (!prompt) return false
  const normalized = normalize(prompt)
  const words = normalized.split(" ").filter(Boolean)
  if (words.length > 16) return false

  return /\b(quem|quando|onde|qual|quanto|quantos|how many|when|who|where|which)\b/u.test(normalized)
}

function toDirectAnswerWithOneEvidence(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length <= 2) return text

  const first = sentences[0]
  const evidence = sentences.find((sentence, index) => {
    if (index === 0) return false
    return hasEvidenceSignal(sentence)
  })

  if (evidence) return `${first} ${evidence}`.trim()
  return first
}

function hasEvidenceSignal(sentence: string): boolean {
  return /\b(\d{4}|\d{1,3}(?:[.,]\d{3})+|block|bloco|tx|inscri[cç][aã]o|fonte|source|timestamp)\b/iu.test(sentence)
}

export function buildTelemetryEvent(decision: ChatIntentDecision, prompt: string): Record<string, unknown> {
  return {
    at: new Date().toISOString(),
    kind: "chat_intent_router",
    intent: decision.intent,
    confidence: decision.confidence,
    stage: decision.stage,
    mode: decision.mode,
    ambiguous: decision.ambiguous,
    prompt_len: prompt.length,
    scores: decision.scores,
    reason: decision.reason,
  }
}

function trimParagraphs(text: string, maxParagraphs: number): string {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
  if (blocks.length <= maxParagraphs) return text
  return blocks.slice(0, maxParagraphs).join("\n\n")
}

function toSentenceLimit(text: string, maxSentences: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (parts.length <= maxSentences) return text
  return `${parts.slice(0, maxSentences).join(" ").trim()}`
}

function trimIfRepeated(text: string, previousText: string | undefined, threshold: number): string {
  if (!previousText) return text

  const score = tokenOverlap(text, previousText)
  if (score < threshold) return text

  const short = toSentenceLimit(text, 3)
  if (short.length < text.length) return short
  return text
}

function tokenOverlap(a: string, b: string): number {
  const at = new Set(normalize(a).split(" ").filter(Boolean))
  const bt = new Set(normalize(b).split(" ").filter(Boolean))
  if (at.size === 0 || bt.size === 0) return 0

  const inter = Array.from(at).filter((token) => bt.has(token)).length
  const union = new Set([...at, ...bt]).size
  return inter / union
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
