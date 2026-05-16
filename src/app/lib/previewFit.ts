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

export interface NonImagePrimaryModeOptions {
  mode?: "default" | "compact"
  hasPreviewUrl?: boolean
  preferPreviewForHtml?: boolean
}

export const UNTRUSTED_IFRAME_SANDBOX = "allow-scripts"
export const SANDBOXED_SRC_DOC_FRAME_ID_TOKEN = "__ORDINALMIND_HTML_FRAME_ID__"
export const SANDBOXED_SRC_DOC_METRICS_MESSAGE_TYPE = "ordinalmind:html-preview-metrics"

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

export function resolveNonImagePrimaryMode(
  kind: MediaKind,
  options: NonImagePrimaryModeOptions = {}
): NonImagePrimaryMode {
  if (kind === "html" && options.hasPreviewUrl && (options.mode === "compact" || options.preferPreviewForHtml)) {
    return "preview"
  }

  switch (kind) {
    case "text":
      return "text"
    case "html":
      return "html"
    case "svg":
      return "preview"
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
  const bridgeScript = `<script>
(() => {
  const FRAME_ID = ${JSON.stringify(SANDBOXED_SRC_DOC_FRAME_ID_TOKEN)};
  const MESSAGE_TYPE = ${JSON.stringify(SANDBOXED_SRC_DOC_METRICS_MESSAGE_TYPE)};
  const PROBE_DELAYS = [0, 80, 180, 320, 500, 800, 1200, 1800, 2600, 3600];

  function applySingleMediaLayout() {
    const root = document.documentElement;
    const body = document.body;
    if (!body) return;

    const directChildren = Array.from(body.children);
    const mediaTags = new Set(["IMG", "SVG", "CANVAS", "VIDEO"]);

    const applyFillStyle = (target) => {
      if (!(target instanceof HTMLElement)) return;
      target.style.width = "100%";
      target.style.height = "100%";
      target.style.maxWidth = "100%";
      target.style.maxHeight = "100%";
      target.style.margin = "0";
      target.style.display = "block";
      if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
        target.style.objectFit = "contain";
      }
    };

    if (directChildren.length !== 1) return;
    const only = directChildren[0];
    const onlyTag = only.tagName.toUpperCase();

    if (mediaTags.has(onlyTag)) {
      root.style.width = "100%";
      root.style.height = "100%";
      body.style.margin = "0";
      body.style.width = "100%";
      body.style.height = "100%";
      body.style.overflow = "hidden";
      applyFillStyle(only);
      return;
    }

    const nestedMedia = Array.from(only.querySelectorAll("img, svg, canvas, video"));
    if (nestedMedia.length === 1) {
      root.style.width = "100%";
      root.style.height = "100%";
      body.style.margin = "0";
      body.style.width = "100%";
      body.style.height = "100%";
      body.style.overflow = "hidden";
      if (only instanceof HTMLElement) {
        only.style.width = "100%";
        only.style.height = "100%";
        only.style.margin = "0";
      }
      applyFillStyle(nestedMedia[0]);
    }
  }

  function hasRenderableContent(width, height) {
    const body = document.body;
    if (!body) return false;
    if ((width || 0) > 1 || (height || 0) > 1) return true;

    const visibleText = (body.textContent || "").replace(/\\s+/g, "");
    if (visibleText.length > 0) return true;

    return Boolean(
      body.querySelector(
        "img,svg,canvas,video,iframe,audio,object,embed,p,pre,code,blockquote,h1,h2,h3,h4,h5,h6,section,article,main,div,span"
      )
    );
  }

  function measure() {
    const root = document.documentElement;
    const body = document.body;
    const width = Math.max(
      root?.scrollWidth || 0,
      root?.offsetWidth || 0,
      body?.scrollWidth || 0,
      body?.offsetWidth || 0,
      1
    );
    const height = Math.max(
      root?.scrollHeight || 0,
      root?.offsetHeight || 0,
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      1
    );
    return { width, height, hasRenderableContent: hasRenderableContent(width, height) };
  }

  function postMetrics(reason) {
    try {
      applySingleMediaLayout();
      const metrics = measure();
      window.parent?.postMessage({
        type: MESSAGE_TYPE,
        frameId: FRAME_ID,
        reason,
        width: metrics.width,
        height: metrics.height,
        hasRenderableContent: metrics.hasRenderableContent,
      }, "*");
    } catch {
      // Ignore cross-context reporting errors.
    }
  }

  window.addEventListener("load", () => postMetrics("load"));
  window.addEventListener("DOMContentLoaded", () => postMetrics("domcontentloaded"));

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => postMetrics("fonts-ready")).catch(() => {});
  }

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => postMetrics("resize"));
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }

  if (typeof MutationObserver !== "undefined") {
    const mutationObserver = new MutationObserver(() => postMetrics("mutation"));
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  for (const delay of PROBE_DELAYS) {
    window.setTimeout(() => postMetrics("probe"), delay);
  }

  postMetrics("init");
})();
</script>`

  if (looksLikeSvg) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${baseTag}
    ${styleBlock}
    ${bridgeScript}
  </head>
  <body class="om-svg-root">
    ${trimmed}
  </body>
</html>`
  }

  if (hasDocumentShell) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${styleBlock}${bridgeScript}`)
    }
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}${styleBlock}${bridgeScript}</head>`)
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${baseTag}
    ${styleBlock}
    ${bridgeScript}
  </head>
  <body>
    <div class="om-root">${trimmed}</div>
  </body>
</html>`
}
