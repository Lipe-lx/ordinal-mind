import type { ByokConfig } from "./index"
import type { ChatIntentDecision, ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { ChatMessage } from "./chatTypes"
import { fetchGeminiWithRetry } from "./geminiRetry"

type LlmIntentDecision = Pick<ChatIntentDecision, "intent" | "confidence" | "mode" | "reason">

interface ClassifierParams {
  config: ByokConfig
  prompt: string
  history: ChatMessage[]
  localDecision: ChatIntentDecision
}

const INTENTS: ChatIntent[] = [
  "greeting",
  "smalltalk_social",
  "acknowledgement",
  "chronicle_query",
  "clarification_request",
  "offtopic_safe",
]
const MODES: ChatResponseMode[] = ["qa", "narrative"]
const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 2200
const MAX_CLASSIFIER_CALLS_PER_MINUTE = 6
const MAX_HISTORY_MESSAGES = 6

const cache = new Map<string, { at: number; decision: LlmIntentDecision }>()
const requestTimes: number[] = []

export function shouldUseLlmIntentClassifier(params: {
  localDecision: ChatIntentDecision
  hasExplicitOverride: boolean
  prompt: string
}): boolean {
  if (params.hasExplicitOverride) return false
  if (!params.prompt.trim()) return false
  if (params.localDecision.intent === "chronicle_query") return false
  if (params.localDecision.confidence >= 0.9 && !params.localDecision.ambiguous) return false
  return params.localDecision.ambiguous || params.localDecision.stage === "l2_structured_fallback"
}

export async function classifyIntentWithLlm(params: ClassifierParams): Promise<LlmIntentDecision | null> {
  const cacheKey = buildCacheKey(params)
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.decision
  }

  if (!canSpendClassifierCall()) return null

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    recordClassifierCall()
    const decision = await requestClassification(params, controller.signal)
    if (!decision) return null
    cache.set(cacheKey, { at: Date.now(), decision })
    return decision
  } catch (error) {
    if (isRateLimitError(error)) {
      console.warn("[NarrativeChat][IntentClassifier] Provider rate-limited classifier call; using local router fallback.")
    } else if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("[NarrativeChat][IntentClassifier] Classifier failed; using local router fallback.", error)
    }
    return null
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

function canSpendClassifierCall(): boolean {
  const now = Date.now()
  while (requestTimes.length > 0 && now - requestTimes[0] > 60_000) {
    requestTimes.shift()
  }
  return requestTimes.length < MAX_CLASSIFIER_CALLS_PER_MINUTE
}

function recordClassifierCall(): void {
  requestTimes.push(Date.now())
}

async function requestClassification(params: ClassifierParams, signal: AbortSignal): Promise<LlmIntentDecision | null> {
  switch (params.config.provider) {
    case "openai":
      return requestOpenAI(params, signal)
    case "anthropic":
      return requestAnthropic(params, signal)
    case "gemini":
      return requestGemini(params, signal)
    case "openrouter":
      return requestOpenRouter(params, signal)
    default:
      return null
  }
}

function buildClassifierMessages(params: ClassifierParams): { system: string; user: string } {
  const history = params.history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n")

  return {
    system: `You classify chat intent for Ordinal Mind, a factual Bitcoin Ordinals Chronicle app.
Return only JSON with keys: intent, mode, confidence, reason.
Allowed intents: ${INTENTS.join(", ")}.
Allowed modes: ${MODES.join(", ")}.
Use chronicle_query when the user asks about the current inscription, its parent/child/genealogy links, mint date, provenance, owner, transfers, collection context, uncertainty, or corrects the scope of a prior factual question.
Use clarification_request only when the user is asking you to clarify and there is no factual target in the current message or recent history.
Do not answer the user. Classify only.`,
    user: `Local router guess:
intent=${params.localDecision.intent}
confidence=${params.localDecision.confidence}
reason=${params.localDecision.reason}

Conversation so far:
${history || "(none)"}

Latest user message:
${params.prompt}

Return JSON now.`,
  }
}

async function requestOpenAI(params: ClassifierParams, signal: AbortSignal): Promise<LlmIntentDecision | null> {
  const { system, user } = buildClassifierMessages(params)
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.config.key}`,
    },
    body: JSON.stringify({
      model: params.config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 120,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ordinal_mind_intent",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              intent: { type: "string", enum: INTENTS },
              mode: { type: "string", enum: MODES },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
            required: ["intent", "mode", "confidence", "reason"],
          },
        },
      },
    }),
    signal,
  })

  if (!res.ok) throw await buildProviderError("OpenAI", res)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string | null } }> }
  return parseDecision(data.choices?.[0]?.message?.content)
}

async function requestAnthropic(params: ClassifierParams, signal: AbortSignal): Promise<LlmIntentDecision | null> {
  const { system, user } = buildClassifierMessages(params)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.config.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: params.config.model,
      max_tokens: 120,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal,
  })

  if (!res.ok) throw await buildProviderError("Anthropic", res)
  const data = await res.json() as { content?: Array<{ type?: string; text?: string }> }
  return parseDecision(data.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join(""))
}

async function requestGemini(params: ClassifierParams, signal: AbortSignal): Promise<LlmIntentDecision | null> {
  const { system, user } = buildClassifierMessages(params)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.config.model}:generateContent?key=${params.config.key}`
  const res = await fetchGeminiWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 120,
        temperature: 0,
        response_mime_type: "application/json",
        response_schema: {
          type: "object",
          properties: {
            intent: { type: "string", enum: INTENTS },
            mode: { type: "string", enum: MODES },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["intent", "mode", "confidence", "reason"],
        },
      },
    }),
    signal,
  }, {
    requestLabel: "gemini_intent_classifier",
  })

  if (!res.ok) throw await buildProviderError("Gemini", res)
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  return parseDecision(data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join(""))
}

async function requestOpenRouter(params: ClassifierParams, signal: AbortSignal): Promise<LlmIntentDecision | null> {
  const { system, user } = buildClassifierMessages(params)
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.config.key}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinal-mind.com",
      "X-Title": "Ordinal Mind",
    },
    body: JSON.stringify({
      model: params.config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 120,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
    signal,
  })

  if (!res.ok) throw await buildProviderError("OpenRouter", res)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string | null } }> }
  return parseDecision(data.choices?.[0]?.message?.content)
}

function parseDecision(value: string | null | undefined): LlmIntentDecision | null {
  if (!value) return null

  const jsonText = extractJsonObject(value)
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText) as Partial<LlmIntentDecision>
    if (!parsed.intent || !INTENTS.includes(parsed.intent)) return null
    if (!parsed.mode || !MODES.includes(parsed.mode)) return null
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
    if (confidence < 0.55) return null

    return {
      intent: parsed.intent,
      mode: parsed.intent === "chronicle_query" ? parsed.mode : "qa",
      confidence,
      reason: `llm_classifier:${String(parsed.reason ?? "no_reason").slice(0, 160)}`,
    }
  } catch {
    return null
  }
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed

  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return trimmed.slice(start, end + 1)
}

async function buildProviderError(provider: string, res: Response): Promise<Error> {
  const body = await res.text().catch(() => "")
  return new Error(`${provider} classifier error ${res.status}: ${body.slice(0, 300)}`)
}

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /\b(429|rate.?limit|quota)\b/iu.test(error.message)
}

function buildCacheKey(params: ClassifierParams): string {
  const historyKey = params.history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => `${message.role}:${normalizeForKey(message.content).slice(0, 120)}`)
    .join("|")
  return [
    params.config.provider,
    params.config.model,
    normalizeForKey(params.prompt),
    params.localDecision.intent,
    historyKey,
  ].join("::")
}

function normalizeForKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
