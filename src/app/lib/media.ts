import type { MediaContext, MediaKind } from "./types"

export type MediaPreviewMode =
  | "image"
  | "audio"
  | "video"
  | "text"
  | "ordinals_preview"

const TEXT_LIKE_APPLICATION_TYPES = new Set([
  "application/csv",
  "application/ecmascript",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-sh",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])

const IMAGE_EXTENSION_LABELS: Record<string, string> = {
  "image/apng": "APNG",
  "image/avif": "AVIF",
  "image/bmp": "BMP",
  "image/gif": "GIF",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  "image/jpeg": "JPG",
  "image/jpg": "JPG",
  "image/png": "PNG",
  "image/svg+xml": "SVG",
  "image/tiff": "TIF",
  "image/vnd.microsoft.icon": "ICO",
  "image/webp": "WEBP",
  "image/x-icon": "ICO",
}

const MIME_TOP_LEVELS = [
  "application",
  "audio",
  "font",
  "example",
  "image",
  "message",
  "model",
  "multipart",
  "text",
  "video",
] as const

const MIME_TOKEN_PATTERN = new RegExp(
  `\\b(?:${MIME_TOP_LEVELS.join("|")})/[a-z0-9][a-z0-9!#$&^_.+-]*\\b`,
  "i"
)

export function buildOrdinalsPreviewUrl(inscriptionId: string): string {
  return `https://ordinals.com/preview/${inscriptionId}`
}

export function normalizeContentType(contentType: string | undefined): string {
  const normalized = contentType?.trim().toLowerCase() ?? ""
  if (!normalized) return ""

  const firstSegment = normalized.split(";")[0]?.trim() ?? ""
  if (!firstSegment) return ""

  if (MIME_TOKEN_PATTERN.test(firstSegment)) {
    const exactMatch = firstSegment.match(MIME_TOKEN_PATTERN)
    return exactMatch?.[0] ?? firstSegment
  }

  const embeddedMatch = normalized.match(MIME_TOKEN_PATTERN)
  if (embeddedMatch?.[0]) return embeddedMatch[0]

  return firstSegment
}

export function isTextLikeContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType)

  if (normalized.startsWith("text/")) return true
  if (TEXT_LIKE_APPLICATION_TYPES.has(normalized)) return true
  if (normalized.endsWith("+json")) return true
  if (normalized.endsWith("+xml")) return true

  return false
}

export function detectMediaKind(contentType: string): MediaKind {
  const normalized = normalizeContentType(contentType)

  if (normalized === "image/svg+xml") return "svg"
  if (normalized.startsWith("image/")) return "image"
  if (normalized.startsWith("audio/")) return "audio"
  if (normalized.startsWith("video/")) return "video"
  if (normalized.startsWith("model/")) return "model"
  if (normalized === "application/pdf") return "document"
  if (normalized.includes("html")) return "html"
  if (isTextLikeContentType(normalized)) return "text"

  return "unknown"
}

export function formatContentTypeLabel(contentType: string | undefined): string {
  const normalized = normalizeContentType(contentType)
  if (!normalized) return "Not available"

  const imageExtension = IMAGE_EXTENSION_LABELS[normalized]
  if (imageExtension) return imageExtension

  const [type, subtype] = normalized.split("/")
  if (!subtype) return normalized.toUpperCase()

  if (type === "image") {
    return subtype
      .replace(/^x-/, "")
      .split("+")[0]
      .toUpperCase()
  }

  return subtype
    .replace(/^x-/, "")
    .split("+")[0]
    .toUpperCase()
}

export function getMediaPreviewMode(
  mediaContext: Pick<MediaContext, "kind">
): MediaPreviewMode {
  switch (mediaContext.kind) {
    case "image":
      return "image"
    case "audio":
      return "audio"
    case "video":
      return "video"
    case "text":
      return "text"
    default:
      return "ordinals_preview"
  }
}

export function getMediaFallbackReason(kind: MediaKind): string | undefined {
  switch (kind) {
    case "image":
      return undefined
    case "svg":
      return "SVG inscriptions render through ordinals preview and stay text-only for synthesis."
    case "html":
      return "HTML inscriptions render through ordinals preview and stay text-only for synthesis."
    case "audio":
      return "Audio inscriptions use native playback and stay text-only for synthesis."
    case "video":
      return "Video inscriptions use native playback and stay text-only for synthesis."
    case "text":
      return "Text inscriptions use lightweight text preview and do not need image input."
    case "model":
      return "3D/model inscriptions render through ordinals preview and stay text-only for synthesis."
    case "document":
      return "Document inscriptions render through ordinals preview and stay text-only for synthesis."
    case "unknown":
      return "This inscription renders through ordinals preview because its content type is not supported natively yet."
  }
}

export function isEmojiOnly(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  
  // Heuristic: Emojis are rarely more than a few characters (even with modifiers)
  // But we allow up to 20 for complex sequences (flags, families, etc)
  if (trimmed.length === 0 || trimmed.length > 20) return false
  
  // Matches strings that consist ONLY of emoji-related characters
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200D|\u20E3)+$/u
  
  // Ensure it's actually an emoji and not just numbers/punctuation which \p{Emoji} can include
  const hasOnlyEmoji = emojiRegex.test(trimmed)
  const hasNormalText = /[a-zA-Z0-9]/.test(trimmed)
  
  return hasOnlyEmoji && !hasNormalText
}
