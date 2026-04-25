import { useRef, useState } from "react"
import { KeyStore } from "../lib/byok"
import { InscriptionMetaWidget } from "./widgets/InscriptionMetaWidget"
import { CollectionContextWidget } from "./widgets/CollectionContextWidget"
import { SourcesWidget, type DataSource } from "./widgets/SourcesWidget"
import { NarrativeRenderer } from "./NarrativeRenderer"
import type { ChronicleResponse } from "../lib/types"
import type { SynthesisPhase } from "../lib/byok/useSynthesize"
import type { SynthesisMode } from "../lib/byok/context"

interface Props {
  chronicle: ChronicleResponse
  narrative: string | null
  streamingText: string
  phase: SynthesisPhase
  elapsed: number
  synthError: string | null
  lastInputMode: SynthesisMode | null
  onSynthesize: () => void
  onCancel: () => void
}

export function ChronicleCard({
  chronicle,
  narrative,
  streamingText,
  phase,
  elapsed,
  synthError,
  lastInputMode,
  onSynthesize,
  onCancel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !imgRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    
    // Base rotation
    let rotateX = ((y - centerY) / centerY) * -15
    let rotateY = ((x - centerX) / centerX) * 15
    let scale = 1.05
    let skewX = 0
    let skewY = 0

    // If dragging, intensify and add deformation
    if (isDragging) {
      rotateX *= 2.5
      rotateY *= 2.5
      scale = 0.95 // Slightly compress while "squeezing"
      skewX = (x - centerX) / 20
      skewY = (y - centerY) / 20
      
      imgRef.current.style.transition = "transform 0.05s linear" // Instant follow
    } else {
      imgRef.current.style.transition = "transform 0.1s ease-out"
    }
    
    imgRef.current.style.transform = `
      rotateX(${rotateX}deg) 
      rotateY(${rotateY}deg) 
      scale(${scale}) 
      skew(${skewX}deg, ${skewY}deg)
    `

    if (isDragging) {
      imgRef.current.style.filter = `brightness(${1 + Math.abs(rotateX + rotateY) / 1000}) contrast(1.1)`
    } else {
      imgRef.current.style.filter = "none"
    }
    
    // Set mouse position for glare effect
    const px = (x / rect.width) * 100
    const py = (y / rect.height) * 100
    containerRef.current.style.setProperty("--mouse-x", `${px}%`)
    containerRef.current.style.setProperty("--mouse-y", `${py}%`)
  }

  const handleMouseDown = () => {
    setIsDragging(true)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    resetTransform()
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
    resetTransform()
  }

  const resetTransform = () => {
    if (!imgRef.current) return
    // Use an elastic transition for the snap back
    imgRef.current.style.transition = "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease"
    imgRef.current.style.transform = "rotateX(0deg) rotateY(0deg) scale(1) skew(0deg, 0deg)"
    imgRef.current.style.filter = "none"
  }

  const { meta, events } = chronicle
  const hasKey = KeyStore.has()
  const config = KeyStore.get()

  // Built data sources from chronicle response metadata
  const sources = buildDataSources(chronicle)

  return (
    <div className="chronicle-card glass-card">
      {/* Left Column */}
      <div className="chronicle-card-left">
        <div 
          className="chronicle-card-content-preview"
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <img
            ref={imgRef}
            src={meta.content_url}
            alt={`Inscription #${meta.inscription_number}`}
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = "none"
            }}
          />
        </div>

        <InscriptionMetaWidget meta={meta} events={events} />
        <CollectionContextWidget collectionContext={chronicle.collection_context} />

      </div>

      {/* Right Column */}
      <div className="chronicle-card-right">
        {!narrative && !hasKey && (
          <p className="chronicle-card-hint" style={{ marginBottom: "var(--space-md)" }}>
            🔑 Set your API key to generate narratives
          </p>
        )}
        <NarrativeRenderer
          narrative={narrative}
          streamingText={streamingText}
          phase={phase}
          elapsed={elapsed}
          providerName={config?.provider}
          modelName={config?.model}
          error={synthError}
          inputMode={lastInputMode}
          onGenerate={hasKey ? onSynthesize : undefined}
          onCancel={onCancel}
        />
        
        {/* Sources Widget */}
        <div style={{ marginTop: "auto" }}>
          <SourcesWidget sources={sources} />
        </div>
      </div>
    </div>
  )
}

// --- Data source builder ---

function buildDataSources(chronicle: ChronicleResponse): DataSource[] {
  const sources: DataSource[] = []
  const events = chronicle.events
  const sourceCatalog = chronicle.source_catalog
  const protocolEntries = sourceCatalog.filter(
    (source) => source.trust_level === "canonical_onchain" || source.trust_level === "official_index"
  )
  const registryEntries = sourceCatalog.filter(
    (source) => source.trust_level === "curated_public_registry"
  )
  const marketEntries = sourceCatalog.filter(
    (source) => source.trust_level === "market_overlay"
  )

  // ordinals.com — always queried for metadata
  sources.push({
    name: "ordinals.com",
    status: protocolEntries.some((entry) => !entry.partial)
      ? "success"
      : protocolEntries.length > 0
        ? "partial"
        : chronicle.meta.inscription_id
          ? "success"
          : "failed",
    detail: chronicle.collection_context.presentation.primary_label
      ? `Metadata + provenance for ${chronicle.collection_context.presentation.primary_label}`
      : "Inscription metadata and protocol provenance",
    cached: chronicle.from_cache,
    count: protocolEntries.length > 0 ? protocolEntries.length : 1,
    links: [
      { label: "Inscription", url: `https://ordinals.com/inscription/${chronicle.meta.inscription_id}` },
      ...protocolEntries.map((entry) => ({ label: entry.source_type, url: entry.url_or_ref }))
    ]
  })

  // mempool.space — transfers
  const transferCount = events.filter(
    (e) => e.event_type === "transfer" || e.event_type === "sale"
  ).length
  sources.push({
    name: "mempool.space",
    status: transferCount > 0 ? "success" : "partial",
    detail: transferCount > 0
      ? `${transferCount} transfer${transferCount > 1 ? "s" : ""} found`
      : "No transfers detected",
    cached: chronicle.from_cache,
    count: transferCount,
    links: events
      .filter((e) => e.event_type === "transfer" || e.event_type === "sale")
      .map((e) => ({
        label: `${e.event_type} tx`,
        url: e.source.ref.startsWith("http") ? e.source.ref : `https://mempool.space/tx/${e.source.ref.split(":")[0]}`
      }))
  })

  // X mentions
  const mentionCount = events.filter((e) => e.event_type === "x_mention").length
  sources.push({
    name: "X mentions",
    status: mentionCount > 0 ? "success" : "partial",
    detail: mentionCount > 0
      ? `${mentionCount} mention${mentionCount > 1 ? "s" : ""} found`
      : "0 results",
    cached: chronicle.from_cache,
    count: mentionCount,
    links: events
      .filter((e) => e.event_type === "x_mention")
      .map((e, i) => ({
        label: e.description ? (e.description.length > 30 ? e.description.substring(0, 30) + "..." : e.description) : `Mention ${i + 1}`,
        url: e.source.ref
      }))
  })

  if (registryEntries.length > 0) {
    sources.push({
      name: "ordinals-collections",
      status: registryEntries.some((entry) => !entry.partial) ? "success" : "partial",
      detail: chronicle.collection_context.registry.match
        ? `${chronicle.collection_context.registry.match.matched_collection} · ${chronicle.collection_context.registry.match.quality_state}`
        : "Curated collection overlay",
      cached: chronicle.from_cache,
      count: registryEntries.length,
      links: registryEntries.map((e) => ({ label: e.source_type, url: e.url_or_ref }))
    })
  }

  if (marketEntries.length > 0) {
    sources.push({
      name: "ord.net",
      status: marketEntries.some((entry) => !entry.partial) ? "success" : "partial",
      detail: chronicle.collection_context.market.match
        ? `${chronicle.collection_context.market.match.collection_name} · ${chronicle.collection_context.market.match.verified ? "verified" : "overlay"}`
        : "Public market overlay",
      cached: chronicle.from_cache,
      count: marketEntries.length,
      links: marketEntries.map((e) => ({ label: e.source_type, url: e.url_or_ref }))
    })
  }

  return sources
}
