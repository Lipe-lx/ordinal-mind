import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isEmojiOnly } from "../lib/media"
import type { MediaKind } from "../lib/types"
import {
  buildSandboxedSrcDoc,
  computeFitScale,
  resolveNonImagePrimaryMode,
  SANDBOXED_SRC_DOC_FRAME_ID_TOKEN,
  SANDBOXED_SRC_DOC_METRICS_MESSAGE_TYPE,
  UNTRUSTED_IFRAME_SANDBOX,
} from "../lib/previewFit"

type NonImageMode = "default" | "compact"
type FitPolicy = "readable"

type RenderState =
  | { status: "loading" }
  | { status: "text"; text: string; truncated: boolean }
  | { status: "html"; srcDoc: string; frameId: string }
  | { status: "preview"; url: string }
  | { status: "preview_image"; imageUrl: string; iframeUrl: string }
  | { status: "fallback"; reason: string }

interface Props {
  kind: MediaKind
  contentType: string
  contentUrl: string
  previewUrl?: string
  className?: string
  mode?: NonImageMode
  fitPolicy?: FitPolicy
  maxTextPreviewBytes?: number
  showMeta?: boolean
  title?: string
  isFullscreen?: boolean
  preferPreviewForHtml?: boolean
}

const DEFAULT_MAX_TEXT_PREVIEW_BYTES = 24 * 1024
const DEFAULT_EMBED_VIEWPORT_SIZE = 512
const COMPACT_EMBED_VIEWPORT_SIZE = 384
const HTML_PREVIEW_CACHE_VERSION = 2
const HTML_PREVIEW_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const HTML_PREVIEW_STORAGE_PREFIX = "ordinalmind_html-preview:"

interface HtmlPreviewMetricsMessage {
  type: typeof SANDBOXED_SRC_DOC_METRICS_MESSAGE_TYPE
  frameId: string
  reason?: string
  width?: number
  height?: number
  hasRenderableContent?: boolean
}

type HtmlPreviewPreference = "html" | "preview"

interface HtmlPreviewCacheEntry {
  version: number
  savedAt: string
  preferredMode?: HtmlPreviewPreference
  srcDoc?: string
}

const MEMORY_HTML_PREVIEW_CACHE = new Map<string, HtmlPreviewCacheEntry>()

function getEmbedViewportSize(mode: NonImageMode): number {
  return mode === "compact" ? COMPACT_EMBED_VIEWPORT_SIZE : DEFAULT_EMBED_VIEWPORT_SIZE
}

function buildHtmlFrameId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `html-preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildHtmlPreviewStorageKey(contentUrl: string): string {
  return `${HTML_PREVIEW_STORAGE_PREFIX}${contentUrl}`
}

function getPreviewSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

function isValidHtmlPreviewCacheEntry(entry: unknown): entry is HtmlPreviewCacheEntry {
  if (!entry || typeof entry !== "object") return false
  const candidate = entry as Partial<HtmlPreviewCacheEntry>
  if (candidate.version !== HTML_PREVIEW_CACHE_VERSION) return false
  if (!candidate.savedAt) return false

  const age = Date.now() - Date.parse(candidate.savedAt)
  return Number.isFinite(age) && age >= 0 && age < HTML_PREVIEW_CACHE_TTL_MS
}

function readHtmlPreviewCache(contentUrl: string): HtmlPreviewCacheEntry | null {
  const cacheKey = buildHtmlPreviewStorageKey(contentUrl)
  const memorySrcDoc = MEMORY_HTML_PREVIEW_CACHE.get(cacheKey)?.srcDoc
  const fromMemory = MEMORY_HTML_PREVIEW_CACHE.get(cacheKey)
  if (isValidHtmlPreviewCacheEntry(fromMemory)) {
    return fromMemory
  }

  const storage = getPreviewSessionStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isValidHtmlPreviewCacheEntry(parsed)) {
      storage.removeItem(cacheKey)
      return null
    }

    const merged: HtmlPreviewCacheEntry = {
      version: parsed.version,
      savedAt: parsed.savedAt,
      preferredMode: parsed.preferredMode,
      srcDoc: memorySrcDoc,
    }
    MEMORY_HTML_PREVIEW_CACHE.set(cacheKey, merged)
    return merged
  } catch {
    return null
  }
}

function writeHtmlPreviewCache(
  contentUrl: string,
  patch: Partial<Pick<HtmlPreviewCacheEntry, "preferredMode" | "srcDoc">>
): void {
  const cacheKey = buildHtmlPreviewStorageKey(contentUrl)
  const existing = readHtmlPreviewCache(contentUrl)
  const next: HtmlPreviewCacheEntry = {
    version: HTML_PREVIEW_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    preferredMode: patch.preferredMode ?? existing?.preferredMode,
    srcDoc: patch.srcDoc ?? existing?.srcDoc,
  }

  MEMORY_HTML_PREVIEW_CACHE.set(cacheKey, next)

  const storage = getPreviewSessionStorage()
  if (!storage) return

  try {
    storage.setItem(
      cacheKey,
      JSON.stringify({
        version: next.version,
        savedAt: next.savedAt,
        preferredMode: next.preferredMode,
      } satisfies Omit<HtmlPreviewCacheEntry, "srcDoc">)
    )
  } catch {
    // Ignore storage quota failures and continue with memory cache only.
  }
}

function createInitialRenderState(params: {
  kind: MediaKind
  mode: NonImageMode
  contentUrl: string
  previewUrl?: string
  preferPreviewForHtml?: boolean
}): RenderState {
  const primaryMode = resolveNonImagePrimaryMode(params.kind, {
    mode: params.mode,
    hasPreviewUrl: Boolean(params.previewUrl),
    preferPreviewForHtml: params.preferPreviewForHtml,
  })

  if (primaryMode === "text") {
    return { status: "loading" }
  }

  if (primaryMode === "html") {
    const cached = readHtmlPreviewCache(params.contentUrl)

    if (cached?.preferredMode === "preview" && params.previewUrl) {
      return { status: "preview", url: params.previewUrl }
    }

    if (cached?.srcDoc) {
      return { status: "html", srcDoc: cached.srcDoc, frameId: buildHtmlFrameId() }
    }

    return { status: "loading" }
  }

  if (params.kind === "unknown") {
    if (params.previewUrl) {
      return { status: "preview_image", imageUrl: params.contentUrl, iframeUrl: params.previewUrl }
    }
    return { status: "preview", url: params.contentUrl }
  }

  if (params.previewUrl) {
    return { status: "preview", url: params.previewUrl }
  }

  return { status: "fallback", reason: "Inline fit preview is unavailable for this media type." }
}

export function NonImageFitPreview({
  kind,
  contentType,
  contentUrl,
  previewUrl,
  className,
  mode = "default",
  fitPolicy = "readable",
  maxTextPreviewBytes = DEFAULT_MAX_TEXT_PREVIEW_BYTES,
  showMeta = true,
  title,
  isFullscreen = false,
  preferPreviewForHtml = true,
}: Props) {
  const [state, setState] = useState<RenderState>(() =>
    createInitialRenderState({ kind, mode, contentUrl, previewUrl, preferPreviewForHtml })
  )
  const [scaleState, setScaleState] = useState({ scale: 1, clipped: false })
  const [surfaceSize, setSurfaceSize] = useState(() => {
    const viewportSize = isFullscreen ? 1024 : getEmbedViewportSize(mode)
    return { width: viewportSize, height: viewportSize }
  })
  const primaryMode = useMemo(
    () => resolveNonImagePrimaryMode(kind, {
      mode,
      hasPreviewUrl: Boolean(previewUrl),
      preferPreviewForHtml,
    }),
    [kind, mode, preferPreviewForHtml, previewUrl]
  )
  const isEmojiText = state.status === "text" && isEmojiOnly(state.text)
  const isShortText = useMemo(() => {
    if (state.status !== "text" || isEmojiText) return false
    const trimmed = state.text.trim()
    return trimmed.length > 0 && trimmed.length < 120 && trimmed.split("\n").length <= 3
  }, [state, isEmojiText])
  const resolvedHtmlSrcDoc = useMemo(() => {
    if (state.status !== "html") return ""
    return state.srcDoc.replaceAll(SANDBOXED_SRC_DOC_FRAME_ID_TOKEN, state.frameId)
  }, [state])

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const textSurfaceRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const htmlLoadTimeoutRef = useRef<number | null>(null)
  const htmlRenderedRef = useRef(false)
  const htmlMetricsRef = useRef<{ width: number; height: number } | null>(null)

  const minScale = useMemo(() => {
    if (fitPolicy !== "readable") return 0.5
    if (primaryMode === "text") return mode === "compact" ? 0.65 : 0.8
    return mode === "compact" ? 0.42 : 0.55
  }, [fitPolicy, mode, primaryMode])

  const setPreviewFallbackState = useCallback(
    (reason: string) => {
      if (kind === "unknown") {
        if (previewUrl) {
          setState({ status: "preview_image", imageUrl: contentUrl, iframeUrl: previewUrl })
          return
        }
        setState({ status: "preview", url: contentUrl })
        return
      }

      if (previewUrl) {
        setState({ status: "preview", url: previewUrl })
        return
      }

      setState({ status: "fallback", reason })
    },
    [contentUrl, kind, previewUrl]
  )

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const fetchTimeoutMs = 6500
    const timeoutId = window.setTimeout(() => {
      controller.abort()
      if (!cancelled) {
        setPreviewFallbackState("Preview timed out.")
      }
    }, fetchTimeoutMs)

    if (primaryMode === "text") {
      void (async () => {
        try {
          const res = await fetch(contentUrl, {
            signal: controller.signal,
            cache: "force-cache",
          })
          if (!res.ok) {
            setPreviewFallbackState("Could not load text preview.")
            return
          }

          const preview = await readTextPreview(res, maxTextPreviewBytes)
          if (!preview.text.trim()) {
            setPreviewFallbackState("Text content is empty.")
            return
          }

          setState({ status: "text", text: preview.text, truncated: preview.truncated })
        } catch (error) {
          if ((error as DOMException).name !== "AbortError") {
            setPreviewFallbackState("Could not load text preview.")
          }
        } finally {
          window.clearTimeout(timeoutId)
        }
      })()

      return () => {
        cancelled = true
        window.clearTimeout(timeoutId)
        controller.abort()
      }
    }

    if (primaryMode === "html") {
      const cached = readHtmlPreviewCache(contentUrl)
      if (cached?.srcDoc) {
        window.clearTimeout(timeoutId)
        return () => {
          cancelled = true
          controller.abort()
        }
      }

      void (async () => {
        try {
          const res = await fetch(contentUrl, {
            signal: controller.signal,
            cache: "force-cache",
          })
          if (!res.ok) {
            setPreviewFallbackState("Could not render this inscription inline.")
            return
          }

          const raw = await res.text()
          if (!raw.trim()) {
            setPreviewFallbackState("Rendered content is empty.")
            return
          }

          const viewportSize = isFullscreen ? 1024 : getEmbedViewportSize(mode)
          const srcDoc = buildSandboxedSrcDoc(raw, contentType, contentUrl)
          writeHtmlPreviewCache(contentUrl, { srcDoc })
          setSurfaceSize({ width: viewportSize, height: viewportSize })
          setState({ status: "html", srcDoc, frameId: buildHtmlFrameId() })
        } catch (error) {
          if ((error as DOMException).name !== "AbortError") {
            setPreviewFallbackState("Could not render this inscription inline.")
          }
        } finally {
          window.clearTimeout(timeoutId)
        }
      })()

      return () => {
        cancelled = true
        window.clearTimeout(timeoutId)
        controller.abort()
      }
    }

    window.clearTimeout(timeoutId)
    // Fallback cases are now handled by initial state since component remounts on kind change

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [contentType, contentUrl, isFullscreen, maxTextPreviewBytes, mode, primaryMode, setPreviewFallbackState])

  const recomputeTextScale = useCallback(() => {
    if (state.status !== "text") return
    if (!stageRef.current || !textSurfaceRef.current) return

    const stage = stageRef.current
    const textSurface = textSurfaceRef.current
    const effectiveMinScale = isEmojiText ? 0.1 : minScale
    const emojiFontSize = isEmojiText
      ? `${Math.max(64, Math.floor(Math.min(stage.clientWidth, stage.clientHeight) * 0.92))}px`
      : null

    if (emojiFontSize) {
      textSurface.style.setProperty("--emoji-font-size", emojiFontSize)
    } else {
      textSurface.style.removeProperty("--emoji-font-size")
    }

    const fit = computeFitScale({
      containerWidth: stage.clientWidth,
      containerHeight: stage.clientHeight,
      contentWidth: textSurface.scrollWidth,
      contentHeight: textSurface.scrollHeight,
      minScale: effectiveMinScale,
      maxScale: 1,
    })

    setScaleState({ scale: fit.scale, clipped: fit.clipped })
    setSurfaceSize({ width: textSurface.scrollWidth, height: textSurface.scrollHeight })
  }, [isEmojiText, minScale, state.status])

  const recomputeHtmlScale = useCallback(() => {
    if (state.status !== "html") return
    if (!stageRef.current) return

    const metrics = htmlMetricsRef.current
    if (!metrics) return
    const contentWidth = Math.max(1, metrics.width)
    const contentHeight = Math.max(1, metrics.height)

    const stageWidth = Math.max(1, stageRef.current.clientWidth)
    const stageHeight = Math.max(1, stageRef.current.clientHeight)

    // HTML/SVG should fit within the preview box footprint (contain) to ensure visibility.
    const containScale = Math.min(stageWidth / contentWidth, stageHeight / contentHeight)
    const safeScale = Number.isFinite(containScale) && containScale > 0 ? Math.min(containScale, 1) : 1
    const clipped = false

    setScaleState({ scale: safeScale, clipped })
    setSurfaceSize({ width: contentWidth, height: contentHeight })
  }, [state.status])

  const recomputePreviewScale = useCallback(() => {
    if (state.status !== "preview") return
    if (!stageRef.current) return

    const viewportSize = isFullscreen ? 1024 : getEmbedViewportSize(mode)
    const stageWidth = Math.max(1, stageRef.current.clientWidth)
    const stageHeight = Math.max(1, stageRef.current.clientHeight)
    const containScale = Math.min(stageWidth / viewportSize, stageHeight / viewportSize)
    const safeScale = Number.isFinite(containScale) && containScale > 0 ? Math.min(containScale, 1) : 1

    setScaleState({ scale: safeScale, clipped: false })
    setSurfaceSize({ width: viewportSize, height: viewportSize })
  }, [isFullscreen, mode, state.status])

  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      if (state.status === "text") recomputeTextScale()
      if (state.status === "html") recomputeHtmlScale()
      if (state.status === "preview") recomputePreviewScale()
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [recomputeHtmlScale, recomputePreviewScale, recomputeTextScale, state.status])

  useEffect(() => {
    if (state.status !== "text") return
    recomputeTextScale()
  }, [recomputeTextScale, state.status])

  useEffect(() => {
    if (state.status !== "preview") return
    recomputePreviewScale()
  }, [recomputePreviewScale, state.status])

  // Note: surfaceSize syncing is handled by remounting via key in parent

  useEffect(() => {
    if (state.status !== "html") return

    htmlRenderedRef.current = false
    htmlMetricsRef.current = null

    htmlLoadTimeoutRef.current = window.setTimeout(() => {
      if (!htmlRenderedRef.current) {
        if (previewUrl) {
          writeHtmlPreviewCache(contentUrl, { preferredMode: "preview" })
        }
        setPreviewFallbackState("Could not load this inscription render inline.")
      }
    }, 7000)

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== "object") return

      const payload = event.data as Partial<HtmlPreviewMetricsMessage>
      if (payload.type !== SANDBOXED_SRC_DOC_METRICS_MESSAGE_TYPE) return
      if (payload.frameId !== state.frameId) return

      const width = typeof payload.width === "number" && Number.isFinite(payload.width)
        ? Math.max(1, payload.width)
        : 1
      const height = typeof payload.height === "number" && Number.isFinite(payload.height)
        ? Math.max(1, payload.height)
        : 1
      const hasRenderableContent = Boolean(payload.hasRenderableContent) || width > 1 || height > 1
      if (!hasRenderableContent) return

      htmlRenderedRef.current = true
      htmlMetricsRef.current = { width, height }
      writeHtmlPreviewCache(contentUrl, { preferredMode: "html" })

      if (htmlLoadTimeoutRef.current !== null) {
        window.clearTimeout(htmlLoadTimeoutRef.current)
        htmlLoadTimeoutRef.current = null
      }

      if (!stageRef.current) {
        setSurfaceSize({ width, height })
        return
      }

      const stageWidth = Math.max(1, stageRef.current.clientWidth)
      const stageHeight = Math.max(1, stageRef.current.clientHeight)
      const containScale = Math.min(stageWidth / width, stageHeight / height)
      const safeScale = Number.isFinite(containScale) && containScale > 0 ? Math.min(containScale, 1) : 1

      setScaleState({ scale: safeScale, clipped: false })
      setSurfaceSize({ width, height })
    }

    window.addEventListener("message", handleMessage)

    return () => {
      if (htmlLoadTimeoutRef.current !== null) {
        window.clearTimeout(htmlLoadTimeoutRef.current)
        htmlLoadTimeoutRef.current = null
      }
      htmlRenderedRef.current = false
      htmlMetricsRef.current = null
      window.removeEventListener("message", handleMessage)
    }
  }, [contentUrl, previewUrl, setPreviewFallbackState, state])

  const rootClassName = [
    "non-image-fit-preview",
    mode === "compact" ? "is-compact" : "",
    state.status === "html" ? "is-html" : "",
    state.status === "text" ? "is-text-content" : "",
    isEmojiText ? "is-emoji-only" : "",
    isShortText ? "is-short-text" : "",
    scaleState.clipped ? "is-clipped" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ")

  if (state.status === "loading") {
    return <div className={rootClassName}>Loading preview…</div>
  }

  if (state.status === "fallback") {
    return (
      <div className={rootClassName} ref={containerRef}>
        <div className="non-image-fit-fallback">
          <div className="non-image-fit-fallback-title">Preview unavailable</div>
          <div className="non-image-fit-fallback-copy">{state.reason}</div>
          <div className="non-image-fit-actions">
            {previewUrl ? (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                Open preview
              </a>
            ) : null}
            <a href={contentUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              Open original
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (state.status === "preview") {
    const offsetX = ((1 - scaleState.scale) * surfaceSize.width) / 2
    const offsetY = ((1 - scaleState.scale) * surfaceSize.height) / 2

    return (
      <div className={rootClassName} ref={containerRef}>
        <div className="non-image-fit-stage" ref={stageRef}>
          <div
            className="non-image-fit-canvas"
            style={{
              width: `${surfaceSize.width}px`,
              height: `${surfaceSize.height}px`,
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleState.scale})`,
            }}
          >
            <iframe
              className="non-image-fit-iframe non-image-fit-iframe--preview"
              title={title ?? "Inscription preview"}
              src={state.url}
              scrolling="no"
              sandbox={UNTRUSTED_IFRAME_SANDBOX}
              loading="lazy"
              onLoad={recomputePreviewScale}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </div>
    )
  }

  if (state.status === "preview_image") {
    return (
      <div className={rootClassName} ref={containerRef}>
        <img
          src={state.imageUrl}
          alt={title ?? "Inscription preview"}
          className="non-image-fit-image"
          loading="lazy"
          onError={() => setState({ status: "preview", url: state.iframeUrl })}
        />
      </div>
    )
  }

  if (state.status === "html") {
    const offsetX = ((1 - scaleState.scale) * surfaceSize.width) / 2
    const offsetY = ((1 - scaleState.scale) * surfaceSize.height) / 2
    return (
      <div className={rootClassName} ref={containerRef}>
        <div className="non-image-fit-stage" ref={stageRef}>
          <div
            className="non-image-fit-canvas"
            style={{
              width: `${surfaceSize.width}px`,
              height: `${surfaceSize.height}px`,
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleState.scale})`,
            }}
          >
            <iframe
              ref={iframeRef}
              className="non-image-fit-iframe"
              title={title ?? "Inscription preview"}
              srcDoc={resolvedHtmlSrcDoc}
              scrolling="no"
              sandbox={UNTRUSTED_IFRAME_SANDBOX}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
        {showMeta && mode !== "compact" ? (
          <div className="non-image-fit-meta">
            <span>{contentType}</span>
            <a href={contentUrl} target="_blank" rel="noopener noreferrer">
              Open original
            </a>
          </div>
        ) : null}
      </div>
    )
  }

  const offsetX = ((1 - scaleState.scale) * surfaceSize.width) / 2
  const offsetY = ((1 - scaleState.scale) * surfaceSize.height) / 2
  return (
    <div className={rootClassName} ref={containerRef}>
      <div className="non-image-fit-stage" ref={stageRef}>
        <div
          ref={textSurfaceRef}
          className={[
            "non-image-fit-canvas",
            "non-image-fit-canvas--text",
            isEmojiText ? "non-image-fit-canvas--emoji" : "",
            isShortText ? "is-short-text" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            width: `${surfaceSize.width}px`,
            height: `${surfaceSize.height}px`,
            transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleState.scale})`,
          }}
        >
          <pre>{state.text}</pre>
        </div>
      </div>
      {showMeta && mode !== "compact" && !isEmojiText ? (
        <div className="non-image-fit-meta">
          <span>{contentType}</span>
          {state.truncated ? <span>Preview truncated</span> : null}
          {scaleState.clipped ? <span>Fitted to readable size</span> : null}
          <a href={contentUrl} target="_blank" rel="noopener noreferrer">
            Open original
          </a>
        </div>
      ) : null}
    </div>
  )
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
