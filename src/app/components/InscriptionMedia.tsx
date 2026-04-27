import { useState, useEffect } from "react"
import { detectMediaKind, getMediaPreviewMode, buildOrdinalsPreviewUrl } from "../lib/media"
import type { RelatedInscriptionSummary } from "../lib/types"

interface Props {
  inscription: RelatedInscriptionSummary
  className?: string
  loading?: "lazy" | "eager"
}

const MAX_TEXT_PREVIEW_BYTES = 12 * 1024 // Slightly smaller for nodes

export function InscriptionMedia({ inscription, className, loading = "lazy" }: Props) {
  const [renderFallback, setRenderFallback] = useState(false)
  const contentType = inscription.content_type || "image/png"
  const kind = detectMediaKind(contentType)
  const previewMode = getMediaPreviewMode({ kind })
  
  const contentUrl = inscription.content_url || `https://ordinals.com/content/${inscription.inscription_id}`
  const previewUrl = buildOrdinalsPreviewUrl(inscription.inscription_id)

  if (renderFallback || previewMode === "ordinals_preview") {
    return (
      <iframe
        className={className}
        title={`Inscription #${inscription.inscription_number ?? "pending"}`}
        src={previewUrl}
        loading={loading}
        sandbox="allow-scripts allow-same-origin"
      />
    )
  }

  if (previewMode === "audio") {
    return (
      <audio
        className={className}
        controls
        src={contentUrl}
        onError={() => setRenderFallback(true)}
      />
    )
  }

  if (previewMode === "video") {
    return (
      <video
        className={className}
        controls
        playsInline
        src={contentUrl}
        onError={() => setRenderFallback(true)}
      />
    )
  }

  if (previewMode === "text") {
    return (
      <TextPreview 
        contentType={contentType} 
        contentUrl={contentUrl} 
        onFallback={() => setRenderFallback(true)} 
        className={className}
      />
    )
  }

  // Default: Image
  return (
    <img
      className={className}
      src={contentUrl}
      alt={`Inscription #${inscription.inscription_number ?? "pending"}`}
      loading={loading}
      onError={() => setRenderFallback(true)}
    />
  )
}

function TextPreview({ 
  contentType, 
  contentUrl, 
  onFallback,
  className
}: { 
  contentType: string, 
  contentUrl: string, 
  onFallback: () => void,
  className?: string
}) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(contentUrl, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error("Fetch failed")
        const body = await res.text()
        setText(body.slice(0, MAX_TEXT_PREVIEW_BYTES))
      })
      .catch(() => onFallback())
    
    return () => controller.abort()
  }, [contentUrl, onFallback])

  if (text === null) return <div className="media-placeholder">Loading text...</div>

  return (
    <div className={`media-text-preview ${className}`}>
      <pre>{text}</pre>
      <div className="media-text-meta">{contentType}</div>
    </div>
  )
}
