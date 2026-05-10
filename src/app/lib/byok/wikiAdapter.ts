import type { Chronicle } from "../types"
import type { ByokConfig } from "./index"
import type { WikiPage, WikiPageDraft } from "../wikiTypes"
import { fetchGeminiWithRetry } from "./geminiRetry"

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export const HYBRID_WIKI_POLICY = `
Hybrid chat policy (Narrative + Wiki):
- Prefer get_raw_events for event-level factual claims.
- Use wiki tools for context/relationships, never as sole source for precise event facts.
- If any tool response indicates partial data, explicitly mention uncertainty.
- Never invent inscription numbers, block heights, transfers, sales, or rarity data.
`

const WIKI_DRAFT_SYSTEM_PROMPT = `You are a factual wiki writer for Bitcoin Ordinals. You will receive raw Chronicle events for one inscription.
Return only valid JSON matching the WikiPageDraft schema.
Rules:
- Every claim must reference source_event_ids from provided events.
- Never invent events, dates, sales, rarity or collection details.
- Keep concise encyclopedia style.
- If uncertain, omit instead of guessing.`

export interface RunByokPromptOptions {
  mode?: "wiki_draft" | "wiki_seed"
  systemPrompt?: string
  responseFormat?: "json_object" | "none"
  requestLabel?: string
}

export function buildHybridUserMessage(
  input: string,
  _options?: { wikiPage?: WikiPage | null; wikiStatus?: string }
): string {
  // We no longer append wiki context to the user message to prevent attribution errors.
  // The wiki context is now handled at the prompt assembly level in prompt.ts.
  return input
}

export async function executeWikiTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/wiki/tools/${toolName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })

  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {
      ok: false,
      error: "invalid_wiki_tool_response",
      raw: text,
      partial: true,
    }
  }
}

export async function generateWikiDraftWithByok(params: {
  chronicle: Chronicle
  config: ByokConfig
  slug: string
  entityType?: "inscription"
}): Promise<WikiPageDraft | null> {
  const { chronicle, config, slug } = params
  const entityType = params.entityType ?? "inscription"

  const prompt = buildWikiDraftPrompt(chronicle, slug, entityType)
  let raw: string
  try {
    raw = await runByokPrompt(config, prompt, { mode: "wiki_draft" })
  } catch (error) {
    logWikiDraftDiagnostic("warn", "byok_request_failed", {
      provider: config.provider,
      model: config.model,
      reason: error instanceof Error ? error.message : "unknown_error",
    })
    return buildLocalWikiDraft(chronicle, config.provider, slug, entityType)
  }

  if (!raw) {
    logWikiDraftDiagnostic("warn", "byok_empty_response", {
      provider: config.provider,
      model: config.model,
    })
    return buildLocalWikiDraft(chronicle, config.provider, slug, entityType)
  }

  const parsed = parseFirstJsonObject(raw)
  if (!parsed || typeof parsed !== "object") {
    logWikiDraftDiagnostic("warn", "byok_invalid_json", {
      provider: config.provider,
      model: config.model,
      response_chars: raw.length,
    })
    return buildLocalWikiDraft(chronicle, config.provider, slug, entityType)
  }

  const draft = sanitizeWikiDraft(parsed as Record<string, unknown>, config.provider, slug, entityType)
  if (!draft) {
    logWikiDraftDiagnostic("warn", "byok_unusable_draft", {
      provider: config.provider,
      model: config.model,
    })
    return buildLocalWikiDraft(chronicle, config.provider, slug, entityType)
  }

  logWikiDraftDiagnostic("info", "byok_draft_generated", {
    provider: config.provider,
    model: config.model,
    source_event_count: draft.source_event_ids.length,
    section_count: draft.sections.length,
  })
  return draft
}

function buildWikiDraftPrompt(
  chronicle: Chronicle,
  slug: string,
  entityType: "inscription"
): string {
  const payload = {
    slug,
    entity_type: entityType,
    inscription: {
      inscription_id: chronicle.meta.inscription_id,
      inscription_number: chronicle.meta.inscription_number,
      sat: chronicle.meta.sat,
      sat_rarity: chronicle.meta.sat_rarity,
      collection: chronicle.collection_context.profile?.name
        ?? chronicle.collection_context.presentation.primary_label
        ?? chronicle.collection_context.market.match?.collection_name
        ?? null,
    },
    events: chronicle.events.map((event) => ({
      id: event.id,
      event_type: event.event_type,
      timestamp: event.timestamp,
      block_height: event.block_height,
      source: event.source,
      description: event.description,
    })),
  }

  return `${WIKI_DRAFT_SYSTEM_PROMPT}\n\nWikiPageDraft schema:\n{\n  "slug": "inscription:<id>",\n  "entity_type": "inscription",\n  "title": "string",\n  "summary": "string",\n  "sections": [{"heading":"string","body":"string","source_event_ids":["ev..."]}],\n  "cross_refs": ["collection:<slug>"],\n  "source_event_ids": ["ev..."],\n  "generated_at": "ISO8601",\n  "byok_provider": "string"\n}\n\nInput JSON:\n${JSON.stringify(payload)}`
}

export async function runByokPrompt(
  config: ByokConfig,
  prompt: string,
  options: RunByokPromptOptions = {}
): Promise<string> {
  const systemPrompt = options.systemPrompt ?? WIKI_DRAFT_SYSTEM_PROMPT
  const responseFormat = options.responseFormat ?? "json_object"
  const requestLabel = options.requestLabel ?? (options.mode === "wiki_seed" ? "gemini_wiki_seed" : "gemini_wiki_draft")

  switch (config.provider) {
    case "openai":
      return runOpenAIStylePrompt({
        url: OPENAI_URL,
        model: config.model,
        key: config.key,
        prompt,
        systemPrompt,
        responseFormat,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.key}`,
        },
      })
    case "openrouter":
      return runOpenAIStylePrompt({
        url: OPENROUTER_URL,
        model: config.model,
        key: config.key,
        prompt,
        systemPrompt,
        responseFormat,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.key}`,
          "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinalmind.com",
          "X-Title": "OrdinalMind",
        },
      })
    case "anthropic":
      return runAnthropicPrompt(config, prompt, { systemPrompt })
    case "gemini":
      return runGeminiPrompt(config, prompt, { systemPrompt, requestLabel })
    default:
      return ""
  }
}

async function runOpenAIStylePrompt(params: {
  url: string
  model: string
  key: string
  prompt: string
  systemPrompt: string
  responseFormat: "json_object" | "none"
  headers: Record<string, string>
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: 900,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.prompt },
    ],
  }
  if (params.responseFormat === "json_object") {
    body.response_format = { type: "json_object" }
  }

  const response = await fetch(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await responseErrorLabel(response, "openai_style_request_failed"))
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
  }

  return json.choices?.[0]?.message?.content ?? ""
}

async function runAnthropicPrompt(
  config: ByokConfig,
  prompt: string,
  options: { systemPrompt: string }
): Promise<string> {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 900,
      system: options.systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(await responseErrorLabel(response, "anthropic_request_failed"))
  }

  const json = await response.json() as {
    content?: Array<{ type?: string; text?: string }>
  }

  return (json.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
}

async function runGeminiPrompt(
  config: ByokConfig,
  prompt: string,
  options: { systemPrompt: string; requestLabel: string }
): Promise<string> {
  const url = `${GEMINI_BASE_URL}/${config.model}:generateContent?key=${config.key}`
  const response = await fetchGeminiWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: options.systemPrompt }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 900 },
    }),
  }, {
    requestLabel: options.requestLabel,
  })

  if (!response.ok) {
    throw new Error(await responseErrorLabel(response, "gemini_request_failed"))
  }

  const json = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
}

function buildLocalWikiDraft(
  chronicle: Chronicle,
  provider: string,
  fallbackSlug: string,
  entityType: "inscription"
): WikiPageDraft | null {
  const sourceEvents = chronicle.events.filter((event) => event.id)
  if (sourceEvents.length === 0) return null

  const genesisEvent = sourceEvents.find((event) => event.event_type === "genesis") ?? sourceEvents[0]
  const inscriptionNumber = Number.isFinite(chronicle.meta.inscription_number)
    ? `#${chronicle.meta.inscription_number}`
    : chronicle.meta.inscription_id
  const title = chronicle.collection_context.presentation.full_label
    ?? chronicle.collection_context.presentation.item_label
    ?? `Inscription ${inscriptionNumber}`
  const genesisDate = formatEventDate(genesisEvent.timestamp)
  const overviewParts = [
    `${title} is a Bitcoin Ordinals inscription recorded at block ${chronicle.meta.genesis_block}.`,
    genesisDate ? `Its genesis event is dated ${genesisDate}.` : "",
  ].filter(Boolean)

  const timelineEvents = sourceEvents
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(0, 6)

  const timelineBody = timelineEvents
    .map((event) => {
      const date = formatEventDate(event.timestamp)
      const prefix = date ? `${date}: ` : ""
      return `${prefix}${event.description}`
    })
    .join(" ")

  const sections = [
    {
      heading: "Overview",
      body: overviewParts.join(" "),
      source_event_ids: [genesisEvent.id],
    },
    {
      heading: "Timeline",
      body: timelineBody || "The available Chronicle events describe the inscription's public on-chain history.",
      source_event_ids: timelineEvents.map((event) => event.id),
    },
  ].filter((section) => section.body && section.source_event_ids.length > 0)

  const sourceEventIds = Array.from(new Set(sections.flatMap((section) => section.source_event_ids)))
  if (sourceEventIds.length === 0) return null

  return {
    slug: fallbackSlug,
    entity_type: entityType,
    title,
    summary: overviewParts.slice(0, 2).join(" ") || `${title} has a source-backed Chronicle timeline.`,
    sections,
    cross_refs: [],
    source_event_ids: sourceEventIds,
    generated_at: new Date().toISOString(),
    byok_provider: `${provider}:local_factual_fallback`,
  }
}

function sanitizeWikiDraft(
  draft: Record<string, unknown>,
  provider: string,
  fallbackSlug: string,
  entityType: "inscription"
): WikiPageDraft | null {
  const sections = Array.isArray(draft.sections)
    ? draft.sections
        .filter((section): section is Record<string, unknown> => Boolean(section) && typeof section === "object")
        .map((section) => ({
          heading: asString(section.heading),
          body: asString(section.body),
          source_event_ids: asStringArray(section.source_event_ids),
        }))
        .filter((section) => section.heading && section.body && section.source_event_ids.length > 0)
    : []

  const sourceEventIds = Array.from(
    new Set([
      ...asStringArray(draft.source_event_ids),
      ...sections.flatMap((section) => section.source_event_ids),
    ])
  )

  if (sourceEventIds.length === 0) return null

  return {
    slug: asString(draft.slug) || fallbackSlug,
    entity_type: entityType,
    title: asString(draft.title) || fallbackSlug,
    summary: asString(draft.summary) || "No summary available.",
    sections,
    cross_refs: asStringArray(draft.cross_refs),
    source_event_ids: sourceEventIds,
    generated_at: asString(draft.generated_at) || new Date().toISOString(),
    byok_provider: provider,
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseFirstJsonObject(text: string): unknown | null {
  const cleaned = text.trim()
  if (!cleaned) return null

  try {
    return JSON.parse(cleaned)
  } catch {
    // keep trying
  }

  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

async function responseErrorLabel(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "")
  const detail = parseProviderError(text)
  return detail
    ? `${fallback}:${response.status}:${detail}`
    : `${fallback}:${response.status}`
}

function parseProviderError(text: string): string {
  if (!text) return ""
  try {
    const json = JSON.parse(text) as {
      error?: { message?: unknown; type?: unknown; code?: unknown } | string
    }
    if (typeof json.error === "string") return limitDiagnostic(json.error)
    const message = typeof json.error?.message === "string" ? json.error.message : ""
    const type = typeof json.error?.type === "string" ? json.error.type : ""
    const code = typeof json.error?.code === "string" ? json.error.code : ""
    return limitDiagnostic([type, code, message].filter(Boolean).join(":"))
  } catch {
    return limitDiagnostic(text)
  }
}

function limitDiagnostic(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 180)
}

function formatEventDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

function logWikiDraftDiagnostic(
  level: "info" | "warn",
  event: string,
  detail: Record<string, unknown>
): void {
  if (typeof console === "undefined") return
  const payload = {
    event,
    ...detail,
  }
  if (level === "warn") {
    console.warn("[OrdinalMind][WikiDraft]", payload)
    return
  }
  console.info("[OrdinalMind][WikiDraft]", payload)
}
