import type { MediaKind } from "./types"

export interface FitScaleInput {
  containerWidth: number
  containerHeight: number
  contentWidth: number
  contentHeight: number
  minScale?: number
  maxScale?: number
}

export interface FitScaleResult {
  scale: number
  clipped: boolean
  baseScale: number
}

export type NonImagePrimaryMode =
  | "text"
  | "html"
  | "preview"
  | "preview_image_candidate"

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function computeFitScale(input: FitScaleInput): FitScaleResult {
  const containerWidth = Math.max(1, input.containerWidth)
  const containerHeight = Math.max(1, input.containerHeight)
  const contentWidth = Math.max(1, input.contentWidth)
  const contentHeight = Math.max(1, input.contentHeight)
  const minScale = input.minScale ?? 0.5
  const maxScale = input.maxScale ?? 1

  const baseScale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight)
  const scale = clamp(baseScale, minScale, maxScale)

  return {
    scale,
    clipped: baseScale < minScale,
    baseScale,
  }
}

export function isNonImageFitKind(kind: MediaKind): boolean {
  return kind !== "image" && kind !== "audio" && kind !== "video"
}

export function resolveNonImagePrimaryMode(kind: MediaKind): NonImagePrimaryMode {
  switch (kind) {
    case "text":
      return "text"
    case "html":
    case "svg":
      return "html"
    case "unknown":
      return "preview_image_candidate"
    default:
      return "preview"
  }
}

export function deriveBaseHref(contentUrl: string): string {
  try {
    return new URL(".", contentUrl).toString()
  } catch {
    return "https://ordinals.com/"
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function buildSandboxedSrcDoc(raw: string, contentType: string, contentUrl: string): string {
  const trimmed = raw.trim()
  const looksLikeSvg = contentType.includes("svg") || /^<svg[\s>]/i.test(trimmed)
  const hasDocumentShell = /<!doctype|<html[\s>]/i.test(trimmed)
  const baseTag = `<base href="${escapeHtmlAttribute(deriveBaseHref(contentUrl))}">`
  const styleBlock = `<style>
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden !important;
  background: transparent;
}
* {
  box-sizing: border-box;
}
.om-root {
  display: inline-block;
  min-width: 1px;
  min-height: 1px;
}
.om-root img,
.om-root video,
.om-root canvas,
.om-root svg,
.om-root iframe {
  max-width: none;
}
.om-svg-root {
  line-height: 0;
}
</style>`

  if (looksLikeSvg) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${baseTag}
    ${styleBlock}
  </head>
  <body class="om-svg-root">
    ${trimmed}
  </body>
</html>`
  }

  if (hasDocumentShell) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${styleBlock}`)
    }
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}${styleBlock}</head>`)
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${baseTag}
    ${styleBlock}
  </head>
  <body>
    <div class="om-root">${trimmed}</div>
  </body>
</html>`
}
