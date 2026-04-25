import { KeyStore } from "../lib/byok"
import { InscriptionMetaWidget } from "./widgets/InscriptionMetaWidget"
import { CollectionContextWidget } from "./widgets/CollectionContextWidget"
import { SourcesWidget, type DataSource } from "./widgets/SourcesWidget"
import { NarrativeRenderer } from "./NarrativeRenderer"
import { InscriptionPreview } from "./InscriptionPreview"
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
  const { meta, events } = chronicle
  const hasKey = KeyStore.has()
  const config = KeyStore.get()

  // Built data sources from chronicle response metadata
  const sources = buildDataSources(chronicle)

  return (
    <div className="chronicle-card glass-card">
      {/* Left Column */}
      <div className="chronicle-card-left">
        <InscriptionPreview chronicle={chronicle} />

        <InscriptionMetaWidget meta={meta} events={events} />

      </div>

      {/* Right Column */}
      <div className="chronicle-card-right">
        <CollectionContextWidget collectionContext={chronicle.collection_context} />
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
    const marketMatch = chronicle.collection_context.market.match
    const isSatflowSource = marketMatch?.source_ref.includes("satflow.com")
    const marketSourceName = isSatflowSource ? "satflow.com" : "ord.net"
    sources.push({
      name: marketSourceName,
      status: marketEntries.some((entry) => !entry.partial) ? "success" : "partial",
      detail: marketMatch
        ? `${marketMatch.collection_name} · ${marketMatch.verified ? "verified" : "overlay"}`
        : "Public market overlay",
      cached: chronicle.from_cache,
      count: marketEntries.length,
      links: marketEntries.map((e) => ({ label: e.source_type, url: e.url_or_ref }))
    })
  }

  return sources
}
