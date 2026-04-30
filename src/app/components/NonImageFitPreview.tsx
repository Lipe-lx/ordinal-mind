import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isEmojiOnly } from "../lib/media"
import type { MediaKind } from "../lib/types"
import { buildSandboxedSrcDoc, computeFitScale, resolveNonImagePrimaryMode } from "../lib/previewFit"

type NonImageMode = "default" | "compact"
type FitPolicy = "readable"

type RenderState =
  | { status: "loading" }
  | { status: "text"; text: string; truncated: boolean }
  | { status: "html"; srcDoc: string }
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
}

const DEFAULT_MAX_TEXT_PREVIEW_BYTES = 24 * 1024
const DEFAULT_EMBED_VIEWPORT_SIZE = 512
const COMPACT_EMBED_VIEWPORT_SIZE = 384

function getEmbedViewportSize(mode: NonImageMode): number {
  return mode === "compact" ? COMPACT_EMBED_VIEWPORT_SIZE : DEFAULT_EMBED_VIEWPORT_SIZE
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
}: Props) {
  const [state, setState] = useState<RenderState>(() => {
    const pMode = resolveNonImagePrimaryMode(kind)
    if (pMode === "text" || pMode === "html") {
      return { status: "loading" }
    }

    if (kind === "unknown") {
      if (previewUrl) {
        return { status: "preview_image", imageUrl: contentUrl, iframeUrl: previewUrl }
      }
      return { status: "preview", url: contentUrl }
    }

    if (previewUrl) {
      return { status: "preview", url: previewUrl }
    }

    return { status: "fallback", reason: "Inline fit preview is unavailable for this media type." }
  })
  const [scaleState, setScaleState] = useState({ scale: 1, clipped: false })
  const [surfaceSize, setSurfaceSize] = useState(() => {
    const viewportSize = isFullscreen ? 1024 : getEmbedViewportSize(mode)
    return { width: viewportSize, height: viewportSize }
  })
  const primaryMode = useMemo(() => resolveNonImagePrimaryMode(kind), [kind])
  const isEmojiText = state.status === "text" && isEmojiOnly(state.text)

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const textSurfaceRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const htmlLoadTimeoutRef = useRef<number | null>(null)
  const htmlProbeTimeoutsRef = useRef<number[]>([])

  const minScale = useMemo(() => {
    if (fitPolicy !== "readable") return 0.5
    return mode === "compact" ? 0.42 : 0.55
  }, [fitPolicy, mode])

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
          setSurfaceSize({ width: viewportSize, height: viewportSize })
          setState({ status: "html", srcDoc: buildSandboxedSrcDoc(raw, contentType, contentUrl) })
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

  const clearHtmlProbeTimeouts = useCallback(() => {
    for (const timeoutId of htmlProbeTimeoutsRef.current) {
      window.clearTimeout(timeoutId)
    }
    htmlProbeTimeoutsRef.current = []
  }, [])

  const recomputeHtmlScale = useCallback(() => {
    if (state.status !== "html") return
    if (!stageRef.current || !iframeRef.current) return

    const doc = iframeRef.current.contentDocument
    if (!doc) return
    normalizeSingleMediaHtmlLayout(doc)

    const root = doc.documentElement
    const body = doc.body

    const contentWidth = Math.max(
      root?.scrollWidth ?? 0,
      root?.offsetWidth ?? 0,
      body?.scrollWidth ?? 0,
      body?.offsetWidth ?? 0,
      1
    )

    const contentHeight = Math.max(
      root?.scrollHeight ?? 0,
      root?.offsetHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      1
    )

    const stageWidth = Math.max(1, stageRef.current.clientWidth)
    const stageHeight = Math.max(1, stageRef.current.clientHeight)

    // HTML/SVG should fit within the preview box footprint (contain) to ensure visibility.
    const containScale = Math.min(stageWidth / contentWidth, stageHeight / contentHeight)
    const safeScale = Number.isFinite(containScale) && containScale > 0 ? Math.min(containScale, 1) : 1
    const clipped = false

    setScaleState({ scale: safeScale, clipped })
    setSurfaceSize({ width: contentWidth, height: contentHeight })
  }, [state.status])

  const scheduleHtmlScaleProbes = useCallback(() => {
    clearHtmlProbeTimeouts()

    // Some HTML inscriptions finish layout after load because they bootstrap
    // via delayed scripts, fonts, or canvas work. We keep probing for a while
    // instead of assuming the first onLoad measurement is final.
    const delays = [0, 80, 180, 320, 500, 800, 1200, 1800, 2600, 3600]

    htmlProbeTimeoutsRef.current = delays.map((delay) =>
      window.setTimeout(() => {
        recomputeHtmlScale()
      }, delay)
    )
  }, [clearHtmlProbeTimeouts, recomputeHtmlScale])

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

  const handleFrameLoad = useCallback(() => {
    if (htmlLoadTimeoutRef.current !== null) {
      window.clearTimeout(htmlLoadTimeoutRef.current)
      htmlLoadTimeoutRef.current = null
    }
    scheduleHtmlScaleProbes()
  }, [scheduleHtmlScaleProbes])

  useEffect(() => {
    if (state.status !== "html") return

    scheduleHtmlScaleProbes()

    htmlLoadTimeoutRef.current = window.setTimeout(() => {
      const doc = iframeRef.current?.contentDocument
      if (!doc || doc.readyState !== "complete") {
        setPreviewFallbackState("Could not load this inscription render inline.")
      }
    }, 9000)

    return () => {
      if (htmlLoadTimeoutRef.current !== null) {
        window.clearTimeout(htmlLoadTimeoutRef.current)
        htmlLoadTimeoutRef.current = null
      }
      clearHtmlProbeTimeouts()
    }
  }, [clearHtmlProbeTimeouts, scheduleHtmlScaleProbes, setPreviewFallbackState, state.status])

  const rootClassName = [
    "non-image-fit-preview",
    mode === "compact" ? "is-compact" : "",
    state.status === "html" ? "is-html" : "",
    state.status === "text" ? "is-text-content" : "",
    isEmojiText ? "is-emoji-only" : "",
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
              sandbox="allow-scripts allow-same-origin"
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
              srcDoc={state.srcDoc}
              scrolling="no"
              sandbox="allow-scripts allow-same-origin"
              onLoad={handleFrameLoad}
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

function normalizeSingleMediaHtmlLayout(doc: Document): void {
  const root = doc.documentElement
  const body = doc.body
  if (!body) return

  const directChildren = Array.from(body.children) as HTMLElement[]
  const mediaTags = new Set(["IMG", "SVG", "CANVAS", "VIDEO"])

  const applyFillStyle = (target: HTMLElement) => {
    target.style.width = "100%"
    target.style.height = "100%"
    target.style.maxWidth = "100%"
    target.style.maxHeight = "100%"
    target.style.margin = "0"
    target.style.display = "block"
    if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
      target.style.objectFit = "contain"
    }
  }

  if (directChildren.length === 1) {
    const only = directChildren[0]
    const onlyTag = only.tagName.toUpperCase()

    if (mediaTags.has(onlyTag)) {
      root.style.width = "100%"
      root.style.height = "100%"
      body.style.margin = "0"
      body.style.width = "100%"
      body.style.height = "100%"
      body.style.overflow = "hidden"
      applyFillStyle(only)
      return
    }

    const nestedMedia = Array.from(only.querySelectorAll("img, svg, canvas, video")) as HTMLElement[]
    if (nestedMedia.length === 1) {
      root.style.width = "100%"
      root.style.height = "100%"
      body.style.margin = "0"
      body.style.width = "100%"
      body.style.height = "100%"
      body.style.overflow = "hidden"
      only.style.width = "100%"
      only.style.height = "100%"
      only.style.margin = "0"
      applyFillStyle(nestedMedia[0])
    }
  }
}
