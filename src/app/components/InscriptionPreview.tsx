import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { getMediaPreviewMode } from "../lib/media"
import { SatRarityBadge, CharmBadge } from "./SatBadge"
import type { ChronicleResponse } from "../lib/types"
import { NonImageFitPreview } from "./NonImageFitPreview"

interface Props {
  initialChronicle: ChronicleResponse
  activeChronicle: ChronicleResponse
  isSwitching: boolean
  error: string | null
  onSwitchTo: (id: string) => Promise<void>
}

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
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement | HTMLImageElement>(null)
  const lastMousePos = useRef({ x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0 })
  const isInteractive = media_context.kind === "image" && !renderFallback

  const isMain = activeChronicle.meta.inscription_id === initialChronicle.meta.inscription_id

  const updateTransform = useCallback((x: number, y: number, dragging: boolean, currentZoom: number) => {
    if (!containerRef.current || !contentRef.current) return

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
      contentRef.current.style.transition = "transform 0.05s linear"
    } else {
      contentRef.current.style.transition = "transform 0.1s ease-out"
    }

    contentRef.current.style.transform = `
      rotateX(${rotateX}deg)
      rotateY(${rotateY}deg)
      scale(${scale})
      skew(${skewX}deg, ${skewY}deg)
    `

    contentRef.current.style.filter = dragging
      ? `brightness(${1 + Math.abs(rotateX + rotateY) / 1000}) contrast(1.1)`
      : "none"

    const px = (relX / rect.width) * 100
    const py = (relY / rect.height) * 100
    containerRef.current.style.setProperty("--mouse-x", `${px}%`)
    containerRef.current.style.setProperty("--mouse-y", `${py}%`)
  }, [containerRef, contentRef])

  const resetTransform = useCallback(() => {
    if (!contentRef.current) return

    contentRef.current.style.transition =
      "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease"
    contentRef.current.style.transform =
      `rotateX(0deg) rotateY(0deg) scale(${zoom}) skew(0deg, 0deg)`
    contentRef.current.style.filter = "none"
  }, [contentRef, zoom])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractive) return
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    updateTransform(e.clientX, e.clientY, isDragging, zoom)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !isInteractive) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.001
      setZoom(prev => {
        const nextZoom = Math.min(Math.max(0.5, prev + delta), 5)
        updateTransform(lastMousePos.current.x, lastMousePos.current.y, isDragging, nextZoom)
        return nextZoom
      })
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [isInteractive, isDragging, updateTransform])

  useEffect(() => {
    if (!isFullscreen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isFullscreen])

  // Global mouse tracking when dragging
  useEffect(() => {
    if (!isDragging || !isInteractive) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      lastMousePos.current = { x: e.clientX, y: e.clientY }
      updateTransform(e.clientX, e.clientY, true, zoom)
    }

    const handleWindowMouseUp = () => {
      setIsDragging(false)
      resetTransform()
    }

    window.addEventListener("mousemove", handleWindowMouseMove)
    window.addEventListener("mouseup", handleWindowMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
    }
  }, [isDragging, isInteractive, zoom, resetTransform, updateTransform])

  const renderPreviewMedia = (fullscreen = false) => {
    if (isSwitching) {
      return (
        <div className="chronicle-card-preview-placeholder fade-in">
          Loading hierarchy data…
        </div>
      )
    }

    if (error && !fullscreen) {
      return (
        <div className="chronicle-card-preview-placeholder has-error">
          <p>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => void switchTo(activeChronicle.meta.inscription_id)}>Retry</button>
        </div>
      )
    }

    if (renderFallback) {
      return (
        <iframe
          key={`${activeChronicle.meta.inscription_id}:${fullscreen ? "fullscreen" : "inline"}:fallback`}
          title={`Inscription #${meta.inscription_number} preview`}
          src={media_context.preview_url}
          loading="lazy"
          scrolling="no"
          sandbox={previewSandbox}
          referrerPolicy="no-referrer"
          className={fullscreen ? "preview-fullscreen-frame" : "inscription-preview-fallback-frame"}
        />
      )
    }

    if (previewMode === "audio") {
      return (
        <audio
          key={`${activeChronicle.meta.inscription_id}:${fullscreen ? "fullscreen" : "inline"}:audio`}
          controls
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      )
    }

    if (previewMode === "video") {
      return (
        <video
          key={`${activeChronicle.meta.inscription_id}:${fullscreen ? "fullscreen" : "inline"}:video`}
          controls
          playsInline
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      )
    }

    if (previewMode === "image") {
      return (
        <img
          key={`${activeChronicle.meta.inscription_id}:${fullscreen ? "fullscreen" : "inline"}:image`}
          ref={!fullscreen ? (contentRef as React.RefObject<HTMLImageElement>) : undefined}
          src={media_context.content_url}
          alt={`Inscription #${meta.inscription_number}`}
          loading="lazy"
          onError={() => setRenderFallback(true)}
          className={fullscreen ? "preview-fullscreen-image" : undefined}
        />
      )
    }

    return (
      <NonImageFitPreview
        key={`${activeChronicle.meta.inscription_id}:${fullscreen}`}
        kind={media_context.kind}
        contentType={media_context.content_type}
        contentUrl={media_context.content_url}
        previewUrl={media_context.preview_url}
        mode="default"
        fitPolicy="readable"
        isFullscreen={fullscreen}
        title={`Inscription #${meta.inscription_number} preview`}
        className={fullscreen ? "non-image-fit-preview--fullscreen" : undefined}
      />
    )
  }

  return (
    <>
      <div
        className={[
          "chronicle-card-content-preview",
          isInteractive ? "is-interactive" : "",
          previewMode === "text" && !renderFallback ? "is-text" : "",
          isSwitching ? "is-loading" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseDown={isInteractive ? () => setIsDragging(true) : undefined}
        onMouseUp={
          isInteractive
            ? () => {
                setIsDragging(false)
                resetTransform()
              }
            : undefined
        }
        onMouseLeave={
          isInteractive && !isDragging
            ? () => {
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
            <button
              className="nav-btn nav-btn--fullscreen"
              onClick={(e) => {
                e.stopPropagation()
                setIsFullscreen(true)
              }}
              disabled={isSwitching}
              title="Open fullscreen preview"
              aria-label="Open fullscreen preview"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              <span className="nav-btn-label">Fullscreen</span>
            </button>
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

        {renderPreviewMedia(false)}

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

      {isFullscreen && typeof document !== "undefined"
        ? createPortal(
            <div className="preview-fullscreen-overlay" onClick={() => setIsFullscreen(false)}>
              <div className="preview-fullscreen-shell" onClick={(event) => event.stopPropagation()}>
                <div className="preview-fullscreen-toolbar">
                  <button
                    className="nav-btn nav-btn--fullscreen-close"
                    onClick={() => setIsFullscreen(false)}
                    title="Close fullscreen"
                    aria-label="Close fullscreen"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="14 10 21 3 21 9" />
                      <polyline points="10 14 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                    <span className="nav-btn-label">Close</span>
                  </button>
                </div>
                <div className="preview-fullscreen-content">
                  {renderPreviewMedia(true)}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
