import type { ChatMessage } from "./chatTypes"

export type ChatIntent =
  | "greeting"
  | "smalltalk_social"
  | "acknowledgement"
  | "chronicle_query"
  | "clarification_request"
  | "offtopic_safe"
  | "knowledge_contribution"

export type RouterStage = "l0_rules" | "l1_semantic" | "l2_structured_fallback"
export type ChatResponseMode = "narrative" | "qa"

export interface ChatIntentDecision {
  intent: ChatIntent
  confidence: number
  stage: RouterStage
  mode: ChatResponseMode
  reason: string
  scores: Record<ChatIntent, number>
  ambiguous: boolean
}

const GREETING_EXACT = new Set([
  "oi", "ola", "olá", "hello", "hi", "hey", "e ai", "eae", "bom dia", "boa tarde", "boa noite",
])

const ACK_EXACT = new Set([
  "ok", "blz", "beleza", "valeu", "thanks", "thank you", "perfeito", "entendi", "show", "massa",
])

const CLARIFICATION_EXACT = new Set([
  "?", "como assim", "nao entendi", "não entendi", "explica", "explique", "detalha", "detalhe", "repete", "repita",
])

const SMALLTALK_PATTERNS = [
  /tudo bem/u,
  /tudo bom/u,
  /como (vai|voce|você|est[aã]o)/u,
  /how are you/u,
  /what.?s up/u,
]

const OFFTOPIC_PATTERNS = [
  /tempo (hoje|amanh[aã])/u,
  /weather/u,
  /futebol/u,
  /pol[ií]tica/u,
  /not[ií]cias/u,
  /filme/u,
]

const CHRONICLE_HINTS = [
  "inscription", "inscricao", "inscrição", "ordinal", "sat", "satoshi", "transfer", "owner", "provenance", "proveni",
  "genesis", "timeline", "colecao", "coleção", "runestone", "block", "tx", "rarity", "market", "price", "collection",
  "parent", "parents", "pai", "mae", "mãe", "filho", "filha", "child", "children", "ancestral", "ancestrais",
  "genealogia", "genealogy", "mint", "minted", "mintado", "mintada", "cunhado", "cunhada", "cunhou", "bloco",
  "colecao", "coleção", "fundador", "founder", "criador", "creator", "supply", "launch", "lancamento", "lançamento",
  "wiki", "record", "records", "update", "atualizar", "registro", "registros",
]

// --- Knowledge Contribution Detection ---
// Detects when the user has first-person or corrective knowledge about a collection.
// IMPORTANT: Only triggers when combined with chronicle/ordinals context to avoid
// false positives on generic first-person statements.

const CONTRIBUTION_PATTERNS = [
  /\b(eu (estava|vi|participei|lembro|sei|sei que|estava|fiz|criei))\b/u,
  /\b(i (was|saw|remember|know|witnessed|created|made|did))\b/u,
  /\b(na verdade|actually|correcting|corrigindo|na real)\b/u,
  /\b(o fundador|the founder|criador|creator|quem criou|who created|quem fez|who made)\b/u,
  /\b(o supply|the supply|o total|total supply|quantos ao todo)\b/u,
  /\b(update|atualizar|corrigir|correct|fix|records|registros|wiki)\b/u,
]

const FIRST_PERSON_COLLECTION_PATTERNS = [
  /\b(minha coleção|my collection|eu mint|i minted|eu comprei|i bought|eu vendi|i sold)\b/u,
  /\b(a gente|nós|we|our community|nossa comunidade|nossa col)\b/u,
  /\b(quando (lançou|mintou|saiu|estreou)|when (it|we) (launched|minted|dropped))\b/u,
]

const NARRATIVE_REQUEST_HINTS = [
  "resumo", "resuma", "resumir", "narrativa", "narrative", "recap", "recapitula", "historia", "história",
]

const PROTOTYPES: Record<ChatIntent, string[]> = {
  greeting: ["oi", "olá", "hello", "hey there", "bom dia"],
  smalltalk_social: ["tudo bem", "como vai", "how are you", "what's up"],
  acknowledgement: ["ok", "valeu", "entendi", "thanks"],
  chronicle_query: [
    "quem é o dono atual", "resuma as transferencias", "qual a proveniencia", "what is the provenance",
    "fale sobre a coleção", "mostre as incertezas", "qual o contexto do bloco",
    "quando a parent foi cunhada", "falo da parent", "qual a inscrição pai", "parent inscription mint date",
  ],
  clarification_request: ["não entendi", "pode explicar", "detalha melhor", "what do you mean"],
  offtopic_safe: ["como está o tempo hoje", "who won the game", "me conta uma piada", "notícias de hoje"],
  knowledge_contribution: [
    "o fundador é o fulano", "essa coleção foi lançada em janeiro",
    "eu estava lá quando mintou", "the creator is known as",
    "na verdade o supply é 10000", "actually the mint was free",
    "eu comprei quando lançou", "a gente criou essa coleção",
    "quem criou foi o", "o criador da coleção",
    "i was there when it dropped", "we minted this collection",
  ],
}

export function routeChatIntent(input: string, history: ChatMessage[]): ChatIntentDecision {
  const normalized = normalize(input)
  const scores = emptyScores()

  const l0 = l0Rules(normalized)
  if (l0) {
    scores[l0.intent] = l0.confidence
    return {
      intent: l0.intent,
      confidence: l0.confidence,
      stage: "l0_rules",
      mode: resolveMode(normalized, l0.intent, history),
      reason: l0.reason,
      scores,
      ambiguous: false,
    }
  }

  const l1Scores = semanticScores(normalized)
  Object.assign(scores, l1Scores)
  const [best, second] = topTwo(l1Scores)
  const margin = best.score - second.score
  if (best.score >= 0.62 && margin >= 0.12) {
    return {
      intent: best.intent,
      confidence: round(best.score),
      stage: "l1_semantic",
      mode: resolveMode(normalized, best.intent, history),
      reason: `semantic_match margin=${round(margin)}`,
      scores,
      ambiguous: false,
    }
  }

  const l2 = structuredFallback(normalized, l1Scores)
  return {
    intent: l2.intent,
    confidence: l2.confidence,
    stage: "l2_structured_fallback",
    mode: resolveMode(normalized, l2.intent, history),
    reason: l2.reason,
    scores,
    ambiguous: true,
  }
}

function l0Rules(normalized: string): { intent: ChatIntent; confidence: number; reason: string } | null {
  if (!normalized) {
    return { intent: "clarification_request", confidence: 0.92, reason: "empty_input" }
  }

  if (GREETING_EXACT.has(normalized)) {
    return { intent: "greeting", confidence: 0.98, reason: "greeting_exact" }
  }

  if (ACK_EXACT.has(normalized)) {
    return { intent: "acknowledgement", confidence: 0.95, reason: "ack_exact" }
  }

  if (CLARIFICATION_EXACT.has(normalized)) {
    return { intent: "clarification_request", confidence: 0.95, reason: "clarification_exact" }
  }

  for (const pattern of SMALLTALK_PATTERNS) {
    if (pattern.test(normalized)) {
      return { intent: "smalltalk_social", confidence: 0.93, reason: `smalltalk_pattern:${pattern}` }
    }
  }

  for (const pattern of OFFTOPIC_PATTERNS) {
    if (pattern.test(normalized) && !hasChronicleHint(normalized)) {
      return { intent: "offtopic_safe", confidence: 0.9, reason: `offtopic_pattern:${pattern}` }
    }
  }

  // knowledge_contribution: requires BOTH a contribution pattern AND a chronicle hint
  // High confidence threshold (0.87) to avoid false positives.
  const hasContributionSignal = CONTRIBUTION_PATTERNS.some((p) => p.test(normalized))
    || FIRST_PERSON_COLLECTION_PATTERNS.some((p) => p.test(normalized))

  if (hasContributionSignal && hasChronicleHint(normalized)) {
    return { intent: "knowledge_contribution", confidence: 0.87, reason: "contribution_pattern_with_chronicle_hint" }
  }

  if (hasChronicleHint(normalized) || normalized.includes("?")) {
    return { intent: "chronicle_query", confidence: 0.85, reason: "chronicle_hint_or_question" }
  }

  return null
}

function semanticScores(normalized: string): Record<ChatIntent, number> {
  const scores = emptyScores()
  for (const [intent, samples] of Object.entries(PROTOTYPES) as Array<[ChatIntent, string[]]>) {
    let best = 0
    for (const sample of samples) {
      const candidate = similarity(normalized, normalize(sample))
      if (candidate > best) best = candidate
    }
    scores[intent] = round(best)
  }
  return scores
}

function structuredFallback(
  normalized: string,
  l1Scores: Record<ChatIntent, number>
): { intent: ChatIntent; confidence: number; reason: string } {
  const short = normalized.split(" ").length <= 3
  const hasQuestion = normalized.includes("?") || /\b(qual|que|como|quando|por que|porque|where|what|how|when)\b/u.test(normalized)

  if (short && !hasQuestion && l1Scores.greeting >= 0.4) {
    return { intent: "greeting", confidence: 0.58, reason: "fallback_short_greeting" }
  }

  if (short && !hasQuestion && l1Scores.acknowledgement >= 0.38) {
    return { intent: "acknowledgement", confidence: 0.56, reason: "fallback_short_ack" }
  }

  if (short && hasQuestion) {
    return { intent: "clarification_request", confidence: 0.55, reason: "fallback_short_question" }
  }

  if (hasQuestion || hasChronicleHint(normalized)) {
    return { intent: "chronicle_query", confidence: 0.57, reason: "fallback_fact_query" }
  }

  return { intent: "clarification_request", confidence: 0.51, reason: "fallback_default_clarify" }
}

function resolveMode(normalized: string, intent: ChatIntent, _history: ChatMessage[]): ChatResponseMode {
  if (intent === "chronicle_query" && NARRATIVE_REQUEST_HINTS.some((hint) => normalized.includes(hint))) {
    return "narrative"
  }
  return "qa"
}

function hasChronicleHint(text: string): boolean {
  return CHRONICLE_HINTS.some((hint) => text.includes(hint))
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const aTokens = new Set(a.split(" "))
  const bTokens = new Set(b.split(" "))
  const intersection = Array.from(aTokens).filter((token) => bTokens.has(token)).length
  const union = new Set([...aTokens, ...bTokens]).size
  const jaccard = union > 0 ? intersection / union : 0

  const a3 = trigrams(a)
  const b3 = trigrams(b)
  const triInter = Array.from(a3).filter((tri) => b3.has(tri)).length
  const triUnion = new Set([...a3, ...b3]).size
  const triScore = triUnion > 0 ? triInter / triUnion : 0

  return round(jaccard * 0.65 + triScore * 0.35)
}

function trigrams(text: string): Set<string> {
  const compact = text.replace(/\s+/g, " ")
  const result = new Set<string>()
  for (let i = 0; i < compact.length - 2; i++) {
    result.add(compact.slice(i, i + 3))
  }
  return result
}

function emptyScores(): Record<ChatIntent, number> {
  return {
    greeting: 0,
    smalltalk_social: 0,
    acknowledgement: 0,
    chronicle_query: 0,
    clarification_request: 0,
    offtopic_safe: 0,
    knowledge_contribution: 0,
  }
}

function topTwo(scores: Record<ChatIntent, number>): [{ intent: ChatIntent; score: number }, { intent: ChatIntent; score: number }] {
  const sorted = (Object.entries(scores) as Array<[ChatIntent, number]>)
    .map(([intent, score]) => ({ intent, score }))
    .sort((a, b) => b.score - a.score)

  return [sorted[0], sorted[1] ?? { intent: "clarification_request", score: 0 }]
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
