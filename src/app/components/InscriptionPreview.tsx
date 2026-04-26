import { useEffect, useRef, useState } from "react"
import { getMediaPreviewMode } from "../lib/media"
import { SatRarityBadge, CharmBadge } from "./SatBadge"
import type { ChronicleResponse } from "../lib/types"

interface Props {
  initialChronicle: ChronicleResponse
  activeChronicle: ChronicleResponse
  isSwitching: boolean
  error: string | null
  onSwitchTo: (id: string) => Promise<void>
}

const MAX_TEXT_PREVIEW_BYTES = 24 * 1024

export function InscriptionPreview({ 
  initialChronicle, 
  activeChronicle, 
  isSwitching, 
  error, 
  onSwitchTo: switchTo 
}: Props) {
  const { meta, media_context } = activeChronicle
  const previewMode = getMediaPreviewMode(media_context)
  const previewSandbox = media_context.preview_url.startsWith("https://ordinals.com/preview/")
    ? "allow-scripts allow-same-origin"
    : "allow-scripts"
  const [renderFallback, setRenderFallback] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const lastMousePos = useRef({ x: 0, y: 0 })
  const isInteractiveImage = previewMode === "image" && !renderFallback

  const isMain = activeChronicle.meta.inscription_id === initialChronicle.meta.inscription_id


  const updateTransform = (x: number, y: number, dragging: boolean, currentZoom: number) => {
    if (!containerRef.current || !imgRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const relX = x - rect.left
    const relY = y - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    let rotateX = ((relY - centerY) / centerY) * -15
    let rotateY = ((relX - centerX) / centerX) * 15
    let scale = (dragging ? 0.95 : 1.05) * currentZoom
    let skewX = 0
    let skewY = 0

    if (dragging) {
      rotateX *= 2.5
      rotateY *= 2.5
      scale = 0.95 * currentZoom
      skewX = (relX - centerX) / 20
      skewY = (relY - centerY) / 20
      imgRef.current.style.transition = "transform 0.05s linear"
    } else {
      imgRef.current.style.transition = "transform 0.1s ease-out"
    }

    imgRef.current.style.transform = `
      rotateX(${rotateX}deg)
      rotateY(${rotateY}deg)
      scale(${scale})
      skew(${skewX}deg, ${skewY}deg)
    `

    imgRef.current.style.filter = dragging
      ? `brightness(${1 + Math.abs(rotateX + rotateY) / 1000}) contrast(1.1)`
      : "none"

    const px = (relX / rect.width) * 100
    const py = (relY / rect.height) * 100
    containerRef.current.style.setProperty("--mouse-x", `${px}%`)
    containerRef.current.style.setProperty("--mouse-y", `${py}%`)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractiveImage) return
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    updateTransform(e.clientX, e.clientY, isDragging, zoom)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !isInteractiveImage) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.001
      setZoom(prev => {
        const nextZoom = Math.min(Math.max(0.5, prev + delta), 5)
        // Immediately update transform for smooth feedback
        updateTransform(lastMousePos.current.x, lastMousePos.current.y, isDragging, nextZoom)
        return nextZoom
      })
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [isInteractiveImage, isDragging]) // Re-bind if interactivity or dragging state changes to ensure correct capture

  const resetTransform = () => {
    if (!imgRef.current) return

    setZoom(1)
    imgRef.current.style.transition =
      "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease"
    imgRef.current.style.transform =
      "rotateX(0deg) rotateY(0deg) scale(1) skew(0deg, 0deg)"
    imgRef.current.style.filter = "none"
  }

  return (
    <div
      className={[
        "chronicle-card-content-preview",
        isInteractiveImage ? "is-interactive" : "",
        previewMode === "text" && !renderFallback ? "is-text" : "",
        isSwitching ? "is-loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={isInteractiveImage ? () => setIsDragging(true) : undefined}
      onMouseUp={
        isInteractiveImage
          ? () => {
              setIsDragging(false)
              resetTransform()
            }
          : undefined
      }
      onMouseLeave={
        isInteractiveImage
          ? () => {
              setIsDragging(false)
              resetTransform()
            }
          : undefined
      }
    >
      {/* Hierarchy Navigation Overlay */}
      <div className="inscription-nav-overlay">
        <div className="inscription-nav-group">
          {activeChronicle.collection_context.protocol.parents?.items.map((parent) => (
            <button
              key={parent.inscription_id}
              className="nav-btn nav-btn--parent"
              onClick={(e) => {
                e.stopPropagation()
                void switchTo(parent.inscription_id)
              }}
              disabled={isSwitching}
              title={`Parent: #${parent.inscription_number ?? parent.inscription_id}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 15-6-6-6 6"/>
              </svg>
              <span className="nav-btn-label">
                Parent {parent.inscription_number ? `#${parent.inscription_number}` : "Inscription"}
              </span>
            </button>
          ))}
          {!isMain && (
             <button
              className="nav-btn nav-btn--reset"
              onClick={(e) => {
                e.stopPropagation()
                void switchTo(initialChronicle.meta.inscription_id)
              }}
              disabled={isSwitching}
              title="Return to main inscription"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              <span className="nav-btn-label">Back to Main</span>
            </button>
          )}
        </div>

        <div className="inscription-nav-group">
          {activeChronicle.collection_context.protocol.children?.items.slice(0, 3).map((child) => (
            <button
              key={child.inscription_id}
              className="nav-btn nav-btn--child"
              onClick={(e) => {
                e.stopPropagation()
                void switchTo(child.inscription_id)
              }}
              disabled={isSwitching}
              title={`Child: #${child.inscription_number ?? child.inscription_id}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6"/>
              </svg>
              <span className="nav-btn-label">
                Child {child.inscription_number ? `#${child.inscription_number}` : "Inscription"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {isSwitching ? (
        <div className="chronicle-card-preview-placeholder fade-in">
          Loading hierarchy data…
        </div>
      ) : error ? (
        <div className="chronicle-card-preview-placeholder has-error">
          <p>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void switchTo(activeChronicle.meta.inscription_id)}>Retry</button>
        </div>
      ) : renderFallback || previewMode === "ordinals_preview" ? (
        <iframe
          key={activeChronicle.meta.inscription_id}
          title={`Inscription #${meta.inscription_number} preview`}
          src={media_context.preview_url}
          loading="lazy"
          sandbox={previewSandbox}
          referrerPolicy="no-referrer"
        />
      ) : previewMode === "audio" ? (
        <audio
          key={activeChronicle.meta.inscription_id}
          controls
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      ) : previewMode === "video" ? (
        <video
          key={activeChronicle.meta.inscription_id}
          controls
          playsInline
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      ) : previewMode === "text" ? (
        <TextPreview
          key={activeChronicle.meta.inscription_id}
          contentType={media_context.content_type}
          contentUrl={media_context.content_url}
          onFallback={setRenderFallback}
        />
      ) : (
        <img
          key={activeChronicle.meta.inscription_id}
          ref={imgRef}
          src={media_context.content_url}
          alt={`Inscription #${meta.inscription_number}`}
          loading="lazy"
          onError={() => setRenderFallback(true)}
        />
      )}

      {/* Sat rarity & charm badges — overlaid on preview */}
      {!isSwitching && (meta.sat_rarity !== "common" || (meta.charms && meta.charms.length > 0)) && (
        <div className="sat-rarity-overlay">
          <SatRarityBadge rarity={meta.sat_rarity} />
          {meta.charms?.map(charm => (
            <CharmBadge key={charm} charm={charm} />
          ))}
        </div>
      )}

      {/* Label when viewing a related inscription */}
      {!isMain && !isSwitching && (
        <div className="nav-preview-label">
          #{meta.inscription_number}
        </div>
      )}
    </div>
  )
}

function TextPreview({
  contentType,
  contentUrl,
  onFallback,
}: {
  contentType: string
  contentUrl: string
  onFallback: (value: boolean) => void
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready"
    text: string
    truncated: boolean
  }>({
    status: "loading",
    text: "",
    truncated: false,
  })

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const res = await fetch(contentUrl, {
          signal: controller.signal,
          cache: "force-cache",
        })

        if (!res.ok) {
          onFallback(true)
          return
        }

        const preview = await readTextPreview(res, MAX_TEXT_PREVIEW_BYTES)
        if (!preview.text.trim()) {
          onFallback(true)
          return
        }

        setState({
          status: "ready",
          text: preview.text,
          truncated: preview.truncated,
        })
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") {
          onFallback(true)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [contentUrl, onFallback])

  if (state.status === "loading") {
    return (
      <div className="chronicle-card-preview-placeholder">
        Loading inscription text preview…
      </div>
    )
  }

  return (
    <div className="chronicle-card-text-preview">
      <pre>{state.text}</pre>
      <div className="chronicle-card-text-meta">
        <span>{contentType}</span>
        {state.truncated ? <span>Preview truncated for performance</span> : null}
      </div>
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
