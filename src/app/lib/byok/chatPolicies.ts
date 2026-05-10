import type { ChatIntent, ChatIntentDecision, ChatResponseMode } from "./chatIntentRouter"
import { detectUserLocale, selectLocalized } from "./language"

export const CHAT_INTENT_ROUTER_V1 = true

export type IntentRouterMode = "off" | "shadow" | "active"

export function getIntentRouterMode(): IntentRouterMode {
  if (!CHAT_INTENT_ROUTER_V1) return "off"
  if (typeof window === "undefined") return "active"

  const override = window.localStorage.getItem("ordinalmind_intent_router_mode")
  if (override === "off" || override === "shadow" || override === "active") {
    return override
  }

  return "active"
}

export interface PolicyOutcome {
  handledLocally: boolean
  responseText?: string
}

export function resolvePolicyResponse(intent: ChatIntent, input: string): PolicyOutcome {
  const locale = detectUserLocale(input)

  switch (intent) {
    case "greeting":
      return {
        handledLocally: true,
        responseText: selectLocalized(locale, {
          "en-US": "Hi. I can help with this Chronicle, whether you want a short overview or a specific answer about provenance, transfers, parent links, or collection context.",
          "pt-BR": "Oi. Posso ajudar com esta Chronicle, seja com uma visão rápida ou com uma resposta específica sobre proveniência, transferências, parent links ou contexto da coleção.",
          "es-ES": "Hola. Puedo ayudarte con esta Chronicle, ya sea con un resumen breve o con una respuesta específica sobre procedencia, transferencias, parent links o contexto de la colección.",
          "fr-FR": "Bonjour. Je peux vous aider avec cette Chronicle, soit avec un bref aperçu, soit avec une réponse précise sur la provenance, les transferts, les parent links ou le contexte de la collection.",
          "de-DE": "Hallo. Ich kann bei dieser Chronicle helfen, entweder mit einem kurzen Überblick oder mit einer konkreten Antwort zu Herkunft, Transfers, Parent-Links oder Sammlungskontext.",
          "it-IT": "Ciao. Posso aiutarti con questa Chronicle, sia con una panoramica breve sia con una risposta specifica su provenienza, trasferimenti, parent links o contesto della collezione.",
        }),
      }
    case "smalltalk_social":
      return {
        handledLocally: true,
        responseText: selectLocalized(locale, {
          "en-US": "All good here. I can stay focused on this inscription and help with its current owner, recent transfers, parent links, or unresolved details.",
          "pt-BR": "Tudo certo por aqui. Posso manter o foco nesta inscrição e ajudar com o owner atual, transferências recentes, parent links ou detalhes ainda em aberto.",
          "es-ES": "Todo bien por aquí. Puedo mantener el foco en esta inscripción y ayudarte con el owner actual, las transferencias recientes, los parent links o los detalles aún no resueltos.",
          "fr-FR": "Tout va bien ici. Je peux rester concentré sur cette inscription et vous aider avec le propriétaire actuel, les transferts récents, les parent links ou les points encore non résolus.",
          "de-DE": "Alles gut hier. Ich kann bei dieser Inschrift bleiben und mit aktuellem Eigentümer, jüngsten Transfers, Parent-Links oder offenen Details helfen.",
          "it-IT": "Tutto bene qui. Posso restare concentrato su questa iscrizione e aiutarti con l'owner attuale, i trasferimenti recenti, i parent links o i dettagli ancora irrisolti.",
        }),
      }
    case "acknowledgement":
      return {
        handledLocally: true,
        responseText: selectLocalized(locale, {
          "en-US": "Got it. Ask the next question about this inscription and I will answer from the available Chronicle data.",
          "pt-BR": "Entendi. Faça a próxima pergunta sobre esta inscrição e eu respondo com base nos dados disponíveis no Chronicle.",
          "es-ES": "Entendido. Haz la siguiente pregunta sobre esta inscripción y responderé con base en los datos disponibles del Chronicle.",
          "fr-FR": "Compris. Posez la prochaine question sur cette inscription et je répondrai à partir des données disponibles dans la Chronicle.",
          "de-DE": "Verstanden. Stell die nächste Frage zu dieser Inschrift, und ich antworte auf Basis der verfügbaren Chronicle-Daten.",
          "it-IT": "Capito. Fai la prossima domanda su questa iscrizione e risponderò in base ai dati disponibili nel Chronicle.",
        }),
      }
    case "clarification_request":
      return {
        handledLocally: true,
        responseText: selectLocalized(locale, {
          "en-US": "I can explain. Tell me which part you mean: overview, on-chain provenance, parent links, transfer history, or collection signals.",
          "pt-BR": "Posso explicar. Diga a qual parte você se refere: visão geral, proveniência on-chain, parent links, histórico de transferências ou sinais da coleção.",
          "es-ES": "Puedo explicarlo. Dime a qué parte te refieres: visión general, procedencia on-chain, parent links, historial de transferencias o señales de la colección.",
          "fr-FR": "Je peux expliquer. Dites-moi quelle partie vous voulez: vue d'ensemble, provenance on-chain, parent links, historique des transferts ou signaux de collection.",
          "de-DE": "Ich kann es erklären. Sag mir, welchen Teil du meinst: Überblick, On-Chain-Herkunft, Parent-Links, Transferhistorie oder Sammlungssignale.",
          "it-IT": "Posso spiegare. Dimmi quale parte intendi: panoramica, provenienza on-chain, parent links, storico dei trasferimenti o segnali della collezione.",
        }),
      }
    case "offtopic_safe":
      return {
        handledLocally: true,
        responseText: selectLocalized(locale, {
          "en-US": "I should stay focused on this inscription's Chronicle. I can answer about provenance, current owner, transfers, parent links, or collection context.",
          "pt-BR": "Devo manter o foco na Chronicle desta inscrição. Posso responder sobre proveniência, owner atual, transferências, parent links ou contexto da coleção.",
          "es-ES": "Debo mantener el foco en la Chronicle de esta inscripción. Puedo responder sobre procedencia, owner actual, transferencias, parent links o contexto de la colección.",
          "fr-FR": "Je dois rester concentré sur la Chronicle de cette inscription. Je peux répondre sur la provenance, le propriétaire actuel, les transferts, les parent links ou le contexte de la collection.",
          "de-DE": "Ich sollte bei der Chronicle dieser Inschrift bleiben. Ich kann zu Herkunft, aktuellem Eigentümer, Transfers, Parent-Links oder Sammlungskontext antworten.",
          "it-IT": "Devo restare concentrato sulla Chronicle di questa iscrizione. Posso rispondere su provenienza, owner attuale, trasferimenti, parent links o contesto della collezione.",
        }),
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
