import { useState, memo } from "react"
import { detectMediaKind, getMediaPreviewMode, buildOrdinalsPreviewUrl } from "../lib/media"
import type { RelatedInscriptionSummary } from "../lib/types"
import { NonImageFitPreview } from "./NonImageFitPreview"
import { isNonImageFitKind } from "../lib/previewFit"

interface Props {
  inscription: RelatedInscriptionSummary
  className?: string
  loading?: "lazy" | "eager"
  compact?: boolean
  showMeta?: boolean
}

/**
 * InscriptionMedia component optimized with memoization.
 */
export const InscriptionMedia = memo(({ inscription, className, loading = "lazy", compact = false, showMeta = true }: Props) => {
  const [renderFallback, setRenderFallback] = useState(false)
  const contentType = inscription.content_type || "application/octet-stream"
  const kind = detectMediaKind(contentType)
  const previewMode = getMediaPreviewMode({ kind })
  
  const contentUrl = inscription.content_url || `https://ordinals.com/content/${inscription.inscription_id}`
  const previewUrl = buildOrdinalsPreviewUrl(inscription.inscription_id)

  if (renderFallback && !isNonImageFitKind(kind)) {
    return (
      <iframe
        className={[className ?? "", "inscription-preview-fallback-frame"].filter(Boolean).join(" ")}
        title={`Inscription #${inscription.inscription_number ?? "pending"}`}
        src={previewUrl}
        loading={loading}
        scrolling="no"
        sandbox="allow-scripts allow-same-origin"
      />
    )
  }

  if (isNonImageFitKind(kind)) {
    return (
      <NonImageFitPreview
        kind={kind}
        contentType={contentType}
        contentUrl={contentUrl}
        previewUrl={previewUrl}
        className={className}
        mode={compact ? "compact" : "default"}
        fitPolicy="readable"
        maxTextPreviewBytes={12 * 1024}
        showMeta={showMeta}
        title={`Inscription #${inscription.inscription_number ?? "pending"}`}
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
})

InscriptionMedia.displayName = "InscriptionMedia"
