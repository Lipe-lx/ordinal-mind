import type { Chronicle, VisionTransport } from "../types"
import { detectMediaKind, normalizeContentType } from "../media"
import { buildCombinedPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt"
import type { ChatMessage } from "./chatTypes"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import { COLLECTION_RESEARCH_TOOLS, type SearchToolDefinition } from "./tools"
import type { ResearchKeys } from "./toolExecutor"
import type { ChatToolPolicyDecision, ToolExposurePolicy } from "./toolPolicy"
import { selectToolsForPolicy } from "./toolPolicy"

const GEMINI_INLINE_LIMIT_BYTES = 20 * 1024 * 1024
const MAX_TEXT_ATTACHMENT_BYTES = 32 * 1024
const MAX_TEXT_ATTACHMENT_CHARS = 12_000
const CONTENT_CACHE_VERSION = 1
const CONTENT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MEMORY_CONTENT_CACHE = new Map<string, CachedTextAttachment>()
const MEDIA_REFERENCE_PATTERN =
  /\b(image|imagem|img|visual|vision|photo|picture|art|artwork|drawing|drawn|depict|depicts|shown|show|shows|visible|look like|looks like|colors?|colour|style|scene|conteud[oa]|content|midia|m[ií]dia|arquivo|file|png|jpg|jpeg|gif|webp|svg|audio|video|html|texto|text|o que (tem|mostra)|do que se refere)\b/i

export type SynthesisMode = "attachments+context" | "image+context" | "text-only"
export type AttachmentTransport = "public_url" | "inline_data" | "inline_text"
export type AttachmentKind = "image" | "text"

export interface ProviderCapabilities {
  supportsVisionInput: boolean
  supportsToolCalling: boolean
  imageTransport: VisionTransport
  preferredApi: string
}

export interface PreparedAttachmentInput {
  id: string
  kind: AttachmentKind
  transport: AttachmentTransport
  label: string
  mimeType: string
  sourceUrl: string
  detail?: "auto"
  url?: string
  data?: string
  text?: string
  truncated?: boolean
}

export interface PreparedSynthesisInput {
  systemPrompt: string
  userPrompt: string
  combinedPrompt: string
  inputMode: SynthesisMode
  searchToolsEnabled: boolean
  availableTools: SearchToolDefinition[]
  toolPolicy: ToolExposurePolicy
  toolPolicyReason: string
  allowedToolNames: string[]
  fallbackReason?: string
  contentDigest?: string
  attachments: PreparedAttachmentInput[]
  wikiPage?: import("../wikiTypes").WikiPage | null
  wikiCompletenessInfo?: string
}

interface PreparedAttachmentBundle {
  attachments: PreparedAttachmentInput[]
  contentDigest?: string
  fallbackReason?: string
}

interface CachedTextAttachment {
  version: number
  savedAt: string
  mimeType: string
  text: string
  truncated: boolean
}

export async function prepareSynthesisInput(
  chronicle: Chronicle,
  capabilities: ProviderCapabilities,
  researchKeys?: ResearchKeys,
  toolPolicyDecision?: ChatToolPolicyDecision,
  options?: {
    wikiPage?: import("../wikiTypes").WikiPage | null
    wikiCompletenessInfo?: string
  }
): Promise<PreparedSynthesisInput> {
  const allAvailableTools = capabilities.supportsToolCalling
    ? getAvailableTools(researchKeys)
    : []
  const decision = toolPolicyDecision ?? {
    policy: "broad" as const,
    allowedToolNames: [],
    geminiMode: "AUTO" as const,
    reason: "default_broad",
  }
  const availableTools = selectToolsForPolicy(allAvailableTools, decision)
  const attachmentBundle = await prepareAttachmentBundle(chronicle, capabilities)
  const prompts = buildPromptsWithContentBundle(
    chronicle,
    availableTools,
    attachmentBundle,
    options?.wikiPage,
    options?.wikiCompletenessInfo
  )

  return {
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    combinedPrompt: prompts.combinedPrompt,
    inputMode: attachmentBundle.attachments.length > 0 ? "attachments+context" : "text-only",
    searchToolsEnabled: availableTools.length > 0,
    availableTools,
    toolPolicy: decision.policy,
    toolPolicyReason: decision.reason,
    allowedToolNames: decision.allowedToolNames,
    fallbackReason: attachmentBundle.fallbackReason,
    contentDigest: attachmentBundle.contentDigest,
    attachments: attachmentBundle.attachments,
    wikiPage: options?.wikiPage,
    wikiCompletenessInfo: options?.wikiCompletenessInfo,
  }
}

export function shouldAttachContentForChat(params: {
  chronicle: Chronicle
  history: ChatMessage[]
  userMessage: string
  mode: ChatResponseMode
  intent: ChatIntent
}): boolean {
  const { chronicle, history, userMessage } = params

  if (!hasAttachablePrimaryContent(chronicle)) return false
  if (history.length === 0) return true
  if (looksLikeMediaQuestion(userMessage)) return true

  const recentTranscript = history
    .slice(-4)
    .map((message) => message.content)
    .join("\n")

  return looksLikeMediaQuestion(recentTranscript) && isShortFollowUp(userMessage)
}

export function getVisionFallbackReason(
  chronicle: Chronicle,
  capabilities: ProviderCapabilities
): string | null {
  if (!chronicle.media_context.vision_eligible) {
    return chronicle.media_context.fallback_reason ?? "This inscription is not eligible for image input."
  }

  if (!capabilities.supportsVisionInput || capabilities.imageTransport === "unsupported") {
    return "The selected provider/model is running in text-only mode for this inscription."
  }

  return null
}

export function renderTextAttachmentBlock(attachment: PreparedAttachmentInput): string {
  const lines = [
    `[Attachment: ${attachment.label}]`,
    `MIME type: ${attachment.mimeType}`,
    `Source URL: ${attachment.sourceUrl}`,
    attachment.truncated ? "Note: The attached text is truncated to a safe browser-side excerpt." : "Note: This attached text is a direct browser-side extract from the public inscription content.",
    "Content:",
    attachment.text ?? "",
  ]

  return lines.join("\n")
}

export function resetPreparedContentCacheForTests(): void {
  MEMORY_CONTENT_CACHE.clear()
}

async function prepareAttachmentBundle(
  chronicle: Chronicle,
  capabilities: ProviderCapabilities
): Promise<PreparedAttachmentBundle> {
  const kind = chronicle.media_context.kind || detectMediaKind(chronicle.media_context.content_type)

  if (kind === "image") {
    return await prepareImageAttachmentBundle(chronicle, capabilities)
  }

  if (kind === "text" || kind === "svg" || kind === "html") {
    return await prepareTextAttachmentBundle(chronicle)
  }

  return {
    attachments: [],
    fallbackReason: chronicle.media_context.fallback_reason,
  }
}

async function prepareImageAttachmentBundle(
  chronicle: Chronicle,
  capabilities: ProviderCapabilities
): Promise<PreparedAttachmentBundle> {
  const fallbackReason = getVisionFallbackReason(chronicle, capabilities)
  if (fallbackReason) {
    return {
      attachments: [],
      fallbackReason,
    }
  }

  const mimeType = normalizeContentType(chronicle.media_context.content_type) || "image/png"
  if (capabilities.imageTransport === "public_url") {
    return {
      attachments: [
        {
          id: "primary-image",
          kind: "image",
          transport: "public_url",
          label: "Primary inscription media",
          mimeType,
          sourceUrl: chronicle.media_context.content_url,
          detail: "auto",
          url: chronicle.media_context.content_url,
        },
      ],
      contentDigest: `- Primary inscription media attached directly from the public content URL (${mimeType}).`,
    }
  }

  const inlineImage = await loadInlineImage(chronicle)
  if (!inlineImage) {
    return {
      attachments: [],
      fallbackReason: "The inscription image could not be loaded inline for this provider.",
    }
  }

  return {
    attachments: [
      {
        id: "primary-image",
        kind: "image",
        transport: "inline_data",
        label: "Primary inscription media",
        mimeType: inlineImage.mimeType || mimeType,
        sourceUrl: chronicle.media_context.content_url,
        detail: "auto",
        data: inlineImage.data,
      },
    ],
    contentDigest: `- Primary inscription media attached as inline bytes from the public content URL (${mimeType}).`,
  }
}

async function prepareTextAttachmentBundle(chronicle: Chronicle): Promise<PreparedAttachmentBundle> {
  const cached = readCachedTextAttachment(chronicle)
  if (cached) {
    return buildTextBundleFromCached(chronicle, cached)
  }

  try {
    const res = await fetch(chronicle.media_context.content_url, { cache: "force-cache" })
    if (!res.ok) {
      return {
        attachments: [],
        fallbackReason: "The inscription text content could not be loaded from the public content URL.",
      }
    }

    const preview = await readTextPreview(res, MAX_TEXT_ATTACHMENT_BYTES)
    const normalizedText = normalizeExtractedText(preview.text)
    if (!normalizedText) {
      return {
        attachments: [],
        fallbackReason: "The inscription content is empty after text extraction.",
      }
    }

    const cachedPayload: CachedTextAttachment = {
      version: CONTENT_CACHE_VERSION,
      savedAt: new Date().toISOString(),
      mimeType: normalizeContentType(chronicle.media_context.content_type) || chronicle.media_context.content_type,
      text: normalizedText.slice(0, MAX_TEXT_ATTACHMENT_CHARS),
      truncated: preview.truncated || normalizedText.length > MAX_TEXT_ATTACHMENT_CHARS,
    }
    writeCachedTextAttachment(chronicle, cachedPayload)
    return buildTextBundleFromCached(chronicle, cachedPayload)
  } catch {
    return {
      attachments: [],
      fallbackReason: "The inscription text content could not be loaded from the public content URL.",
    }
  }
}

function buildTextBundleFromCached(
  chronicle: Chronicle,
  cached: CachedTextAttachment
): PreparedAttachmentBundle {
  const attachment: PreparedAttachmentInput = {
    id: "primary-text",
    kind: "text",
    transport: "inline_text",
    label: "Primary inscription source",
    mimeType: cached.mimeType || normalizeContentType(chronicle.media_context.content_type) || "text/plain",
    sourceUrl: chronicle.media_context.content_url,
    text: cached.text,
    truncated: cached.truncated,
  }

  const characterCount = cached.text.length.toLocaleString("en-US")
  const digest = [
    `- Primary inscription source attached as inline text (${attachment.mimeType}).`,
    `- Extracted characters: ${characterCount}${cached.truncated ? " (truncated excerpt)" : ""}.`,
    "- The attached text came directly from the public inscription content URL in the browser.",
  ].join("\n")

  return {
    attachments: [attachment],
    contentDigest: digest,
  }
}

function buildPromptsWithContentBundle(
  chronicle: Chronicle,
  availableTools: SearchToolDefinition[],
  bundle: PreparedAttachmentBundle,
  wikiPage?: import("../wikiTypes").WikiPage | null,
  wikiCompletenessInfo?: string
) {
  const systemPrompt = buildSystemPrompt(availableTools, wikiPage, wikiCompletenessInfo)
  const baseUserPrompt = buildUserPrompt(chronicle)
  const augmentedUserPrompt = appendContentBundleToPrompt(baseUserPrompt, bundle)

  return {
    systemPrompt,
    userPrompt: augmentedUserPrompt,
    combinedPrompt: buildCombinedPrompt(chronicle, availableTools, wikiPage, wikiCompletenessInfo),
  }
}

function appendContentBundleToPrompt(prompt: string, bundle: PreparedAttachmentBundle): string {
  if (bundle.attachments.length === 0 && !bundle.contentDigest) return prompt

  const attachmentSummary = bundle.attachments.length > 0
    ? bundle.attachments
        .map((attachment) => `- ${attachment.label}: ${attachment.kind} via ${attachment.transport} (${attachment.mimeType})`)
        .join("\n")
    : "- No attachment could be prepared."

  const digest = bundle.contentDigest ? bundle.contentDigest : "- No content digest available."

  return `${prompt}

Primary inscription content bundle:
${attachmentSummary}
${digest}
- Treat these attachments as direct browser-side fetches from the public inscription content URL.
- Prefer the attached source material over guesses about what the inscription contains.`
}

function hasAttachablePrimaryContent(chronicle: Chronicle): boolean {
  const kind = chronicle.media_context.kind || detectMediaKind(chronicle.media_context.content_type)
  return kind === "image" || kind === "text" || kind === "svg" || kind === "html"
}

function looksLikeMediaQuestion(text: string): boolean {
  return MEDIA_REFERENCE_PATTERN.test(text)
}

function isShortFollowUp(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= 10
}

async function loadInlineImage(
  chronicle: Chronicle
): Promise<{ mimeType?: string, data?: string } | null> {
  try {
    const res = await fetch(chronicle.media_context.content_url)
    if (!res.ok) return null

    const blob = await res.blob()
    if (blob.size > GEMINI_INLINE_LIMIT_BYTES) return null

    const mimeType = blob.type || chronicle.media_context.content_type
    const data = await blobToBase64(blob)
    return {
      mimeType,
      data,
    }
  } catch {
    return null
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }

  return btoa(binary)
}

async function readTextPreview(
  res: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const text = await res.text()
    return {
      text: text.slice(0, maxBytes),
      truncated: text.length > maxBytes,
    }
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    const remaining = maxBytes - totalBytes
    if (remaining <= 0) {
      truncated = true
      await reader.cancel()
      break
    }

    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining))
      totalBytes += remaining
      truncated = true
      await reader.cancel()
      break
    }

    chunks.push(value)
    totalBytes += value.byteLength
  }

  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    text: new TextDecoder().decode(merged),
    truncated,
  }
}

function normalizeExtractedText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
}

function readCachedTextAttachment(chronicle: Chronicle): CachedTextAttachment | null {
  const cacheKey = buildContentCacheKey(chronicle)
  const fromMemory = MEMORY_CONTENT_CACHE.get(cacheKey)
  if (isUsableCachedTextAttachment(fromMemory)) {
    return fromMemory
  }

  const storage = getLocalStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedTextAttachment
    if (!isUsableCachedTextAttachment(parsed)) {
      storage.removeItem(cacheKey)
      return null
    }
    MEMORY_CONTENT_CACHE.set(cacheKey, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeCachedTextAttachment(chronicle: Chronicle, cached: CachedTextAttachment): void {
  const cacheKey = buildContentCacheKey(chronicle)
  MEMORY_CONTENT_CACHE.set(cacheKey, cached)

  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(cacheKey, JSON.stringify(cached))
  } catch {
    // Ignore storage quota errors and continue with memory cache only.
  }
}

function isUsableCachedTextAttachment(
  cached: CachedTextAttachment | undefined | null
): cached is CachedTextAttachment {
  if (!cached) return false
  if (cached.version !== CONTENT_CACHE_VERSION) return false
  if (!cached.savedAt || !cached.text || !cached.mimeType) return false

  const age = Date.now() - Date.parse(cached.savedAt)
  return Number.isFinite(age) && age >= 0 && age <= CONTENT_CACHE_TTL_MS
}

function buildContentCacheKey(chronicle: Chronicle): string {
  const raw = [
    chronicle.meta.inscription_id,
    chronicle.media_context.content_url,
    normalizeContentType(chronicle.media_context.content_type),
  ].join("|")
  return `ordinalmind:content-bundle:v${CONTENT_CACHE_VERSION}:${hashString(raw)}`
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

function getAvailableTools(keys?: ResearchKeys): SearchToolDefinition[] {
  return COLLECTION_RESEARCH_TOOLS.filter(tool => {
    if (!tool.requiresKeys || tool.requiresKeys.length === 0) return true

    return tool.requiresKeys.some(keyName => {
      const key = keys?.[keyName]
      return !!key && key.trim().length > 0
    })
  })
}
