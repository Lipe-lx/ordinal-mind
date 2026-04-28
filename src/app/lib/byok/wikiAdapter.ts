import type { Chronicle } from "../types"
import type { ByokConfig } from "./index"
import type { WikiPage, WikiPageDraft } from "../wikiTypes"

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

export function buildHybridUserMessage(
  input: string,
  options?: { wikiPage?: WikiPage | null; wikiStatus?: string }
): string {
  const hints: string[] = [HYBRID_WIKI_POLICY.trim()]

  if (options?.wikiPage) {
    hints.push(`Known wiki context: ${options.wikiPage.title} — ${options.wikiPage.summary}`)
  }

  if (options?.wikiStatus && options.wikiStatus !== "idle") {
    hints.push(`Wiki context status: ${options.wikiStatus}`)
  }

  return `${input}\n\n[System Context]\n${hints.join("\n")}`
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
  const raw = await runByokPrompt(config, prompt)
  if (!raw) return null

  const parsed = parseFirstJsonObject(raw)
  if (!parsed || typeof parsed !== "object") return null

  return sanitizeWikiDraft(parsed as Record<string, unknown>, config.provider, slug, entityType)
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
      collection: chronicle.collection_context.market.match?.collection_name
        ?? chronicle.collection_context.registry.match?.matched_collection
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

async function runByokPrompt(config: ByokConfig, prompt: string): Promise<string> {
  switch (config.provider) {
    case "openai":
      return runOpenAIStylePrompt({
        url: OPENAI_URL,
        model: config.model,
        key: config.key,
        prompt,
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.key}`,
          "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinal-mind.com",
          "X-Title": "Ordinal Mind",
        },
      })
    case "anthropic":
      return runAnthropicPrompt(config, prompt)
    case "gemini":
      return runGeminiPrompt(config, prompt)
    default:
      return ""
  }
}

async function runOpenAIStylePrompt(params: {
  url: string
  model: string
  key: string
  prompt: string
  headers: Record<string, string>
}): Promise<string> {
  const response = await fetch(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify({
      model: params.model,
      max_tokens: 900,
      messages: [
        { role: "system", content: WIKI_DRAFT_SYSTEM_PROMPT },
        { role: "user", content: params.prompt },
      ],
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) return ""

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>
  }

  return json.choices?.[0]?.message?.content ?? ""
}

async function runAnthropicPrompt(config: ByokConfig, prompt: string): Promise<string> {
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
      system: WIKI_DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  })

  if (!response.ok) return ""

  const json = await response.json() as {
    content?: Array<{ type?: string; text?: string }>
  }

  return (json.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
}

async function runGeminiPrompt(config: ByokConfig, prompt: string): Promise<string> {
  const url = `${GEMINI_BASE_URL}/${config.model}:generateContent?key=${config.key}`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: WIKI_DRAFT_SYSTEM_PROMPT }],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 900 },
    }),
  })

  if (!response.ok) return ""

  const json = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
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

function parseFirstJsonObject(text: string): unknown | null {
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
