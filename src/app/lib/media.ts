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

export function buildOrdinalsPreviewUrl(inscriptionId: string): string {
  return `https://ordinals.com/preview/${inscriptionId}`
}

export function normalizeContentType(contentType: string | undefined): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? ""
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
