import type { Chronicle, VisionTransport } from "../types"
import { buildCombinedPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt"
import { COLLECTION_RESEARCH_TOOLS, type SearchToolDefinition } from "./tools"
import type { ResearchKeys } from "./toolExecutor"

const GEMINI_INLINE_LIMIT_BYTES = 20 * 1024 * 1024

export type SynthesisMode = "image+context" | "text-only"

export interface ProviderCapabilities {
  supportsVisionInput: boolean
  supportsToolCalling: boolean
  imageTransport: VisionTransport
  preferredApi: string
}

export interface PreparedImageInput {
  transport: Exclude<VisionTransport, "unsupported">
  detail: "auto"
  url?: string
  mimeType?: string
  data?: string
}

export interface PreparedSynthesisInput {
  systemPrompt: string
  userPrompt: string
  combinedPrompt: string
  inputMode: SynthesisMode
  searchToolsEnabled: boolean
  availableTools: SearchToolDefinition[]
  fallbackReason?: string
  image?: PreparedImageInput
}

export async function prepareSynthesisInput(
  chronicle: Chronicle,
  capabilities: ProviderCapabilities,
  researchKeys?: ResearchKeys
): Promise<PreparedSynthesisInput> {
  const availableTools = capabilities.supportsToolCalling 
    ? getAvailableTools(researchKeys) 
    : []

  const base = {
    systemPrompt: buildSystemPrompt(availableTools),
    userPrompt: buildUserPrompt(chronicle),
    combinedPrompt: buildCombinedPrompt(chronicle, availableTools),
    searchToolsEnabled: availableTools.length > 0,
    availableTools,
  }

  const fallbackReason = getVisionFallbackReason(chronicle, capabilities)
  if (fallbackReason) {
    return {
      ...base,
      inputMode: "text-only",
      fallbackReason,
    }
  }

  if (capabilities.imageTransport === "public_url") {
    return {
      ...base,
      inputMode: "image+context",
      image: {
        transport: "public_url",
        detail: "auto",
        url: chronicle.media_context.content_url,
      },
    }
  }

  const inlineImage = await loadInlineImage(chronicle)
  if (!inlineImage) {
    return {
      ...base,
      inputMode: "text-only",
      fallbackReason: "The inscription image could not be loaded inline for this provider.",
    }
  }

  return {
    ...base,
    inputMode: "image+context",
    image: inlineImage,
  }
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

async function loadInlineImage(chronicle: Chronicle): Promise<PreparedImageInput | null> {
  try {
    const res = await fetch(chronicle.media_context.content_url)
    if (!res.ok) return null

    const blob = await res.blob()
    if (blob.size > GEMINI_INLINE_LIMIT_BYTES) return null

    const mimeType = blob.type || chronicle.media_context.content_type
    const data = await blobToBase64(blob)
    return {
      transport: "inline_data",
      detail: "auto",
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
    // Use apply to avoid spread operator issue with large arrays and target compatibility
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }

  return btoa(binary)
}

function getAvailableTools(keys?: ResearchKeys): SearchToolDefinition[] {
  return COLLECTION_RESEARCH_TOOLS.filter(tool => {
    // If tool doesn't require any keys, it's always available
    if (!tool.requiresKeys || tool.requiresKeys.length === 0) return true
    
    // If it requires keys, check if at least one is present and not empty
    return tool.requiresKeys.some(keyName => {
      const key = keys?.[keyName]
      return !!key && key.trim().length > 0
    })
  })
}
