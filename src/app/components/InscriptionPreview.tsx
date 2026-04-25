import { useEffect, useRef, useState } from "react"
import { getMediaPreviewMode } from "../lib/media"
import type { ChronicleResponse } from "../lib/types"

interface Props {
  chronicle: ChronicleResponse
}

const MAX_TEXT_PREVIEW_BYTES = 24 * 1024

export function InscriptionPreview({ chronicle }: Props) {
  const { meta, media_context } = chronicle
  const previewMode = getMediaPreviewMode(media_context)
  const [renderFallback, setRenderFallback] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const isInteractiveImage = previewMode === "image" && !renderFallback

  useEffect(() => {
    setRenderFallback(false)
    setIsDragging(false)
  }, [meta.inscription_id, previewMode])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isInteractiveImage || !containerRef.current || !imgRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    let rotateX = ((y - centerY) / centerY) * -15
    let rotateY = ((x - centerX) / centerX) * 15
    let scale = 1.05
    let skewX = 0
    let skewY = 0

    if (isDragging) {
      rotateX *= 2.5
      rotateY *= 2.5
      scale = 0.95
      skewX = (x - centerX) / 20
      skewY = (y - centerY) / 20
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

    imgRef.current.style.filter = isDragging
      ? `brightness(${1 + Math.abs(rotateX + rotateY) / 1000}) contrast(1.1)`
      : "none"

    const px = (x / rect.width) * 100
    const py = (y / rect.height) * 100
    containerRef.current.style.setProperty("--mouse-x", `${px}%`)
    containerRef.current.style.setProperty("--mouse-y", `${py}%`)
  }

  const resetTransform = () => {
    if (!imgRef.current) return

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
      {renderFallback || previewMode === "ordinals_preview" ? (
        <iframe
          title={`Inscription #${meta.inscription_number} preview`}
          src={media_context.preview_url}
          loading="lazy"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : previewMode === "audio" ? (
        <audio
          controls
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      ) : previewMode === "video" ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={media_context.content_url}
          onError={() => setRenderFallback(true)}
        />
      ) : previewMode === "text" ? (
        <TextPreview
          contentType={media_context.content_type}
          contentUrl={media_context.content_url}
          onFallback={setRenderFallback}
        />
      ) : (
        <img
          ref={imgRef}
          src={media_context.content_url}
          alt={`Inscription #${meta.inscription_number}`}
          loading="lazy"
          onError={() => setRenderFallback(true)}
        />
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
