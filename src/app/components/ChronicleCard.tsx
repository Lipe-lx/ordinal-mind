import { KeyStore } from "../lib/byok"
import { SatBadge } from "./SatBadge"
import { InscriptionMetaWidget } from "./widgets/InscriptionMetaWidget"
import { SourcesWidget, type DataSource } from "./widgets/SourcesWidget"
import { NarrativeRenderer } from "./NarrativeRenderer"
import type { ChronicleResponse } from "../lib/types"
import type { SynthesisPhase } from "../lib/byok/useSynthesize"

interface Props {
  chronicle: ChronicleResponse
  narrative: string | null
  streamingText: string
  phase: SynthesisPhase
  elapsed: number
  synthError: string | null
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
  onSynthesize,
  onCancel,
}: Props) {
  const { meta, events } = chronicle
  const hasKey = KeyStore.has()
  const config = KeyStore.get()

  function handleShare() {
    const text = `Inscription #${meta.inscription_number} — ${events.length} events in its Chronicle. Explore on Ordinal Mind.`
    const url = window.location.href

    if (navigator.share) {
      navigator.share({ title: "Ordinal Mind Chronicle", text, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {})
    }
  }

  // Build data sources from chronicle response metadata
  const sources = buildDataSources(chronicle)

  return (
    <div className="chronicle-card glass-card">
      {/* Left Column */}
      <div className="chronicle-card-left">
        <div className="chronicle-card-content-preview">
          <img
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

        <div className="chronicle-card-actions" style={{ marginTop: "var(--space-md)" }}>
          <button
            className="btn btn-secondary"
            onClick={handleShare}
            id="share-btn"
            style={{ width: "100%" }}
          >
            Share
          </button>
        </div>
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

  // ordinals.com — always queried for metadata
  sources.push({
    name: "ordinals.com",
    status: chronicle.meta.inscription_id ? "success" : "failed",
    detail: "Inscription metadata",
    cached: chronicle.from_cache,
    count: 1
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
    count: transferCount
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
    count: mentionCount
  })

  return sources
}
