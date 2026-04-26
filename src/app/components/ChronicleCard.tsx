import { KeyStore } from "../lib/byok"
import { CollectionContextWidget } from "./widgets/CollectionContextWidget"
import { SourcesWidget, type DataSource } from "./widgets/SourcesWidget"
import { NarrativeRenderer } from "./NarrativeRenderer"
import type { ChronicleResponse, MentionProviderDebug, SocialSignalProvider } from "../lib/types"
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
  onOpenBYOK: () => void
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
  onOpenBYOK,
  onCancel,
}: Props) {
  const hasKey = KeyStore.has()
  const config = KeyStore.get()

  // Built data sources from chronicle response metadata
  const sources = buildDataSources(chronicle)

  return (
    <div className="chronicle-card glass-card">
      <CollectionContextWidget collectionContext={chronicle.collection_context} />
      <CollectorSignalsPanel chronicle={chronicle} />
      {chronicle.debug_info?.mention_providers && (
        <details style={{ marginBottom: "var(--space-md)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: "0.5rem" }}>
            Collector signals debug
          </summary>
          <CollectorSignalsDebug debugInfo={chronicle.debug_info.mention_providers} />
        </details>
      )}
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
        onGenerate={hasKey ? onSynthesize : onOpenBYOK}
        actionLabel={hasKey ? "✨ Generative Chronicle" : "🔑 Configure BYOK"}
        emptyMessage={
          hasKey
            ? "Generate an AI-powered Chronicle narrative from the factual timeline above."
            : "Unlock the client-side Generative Chronicle with your BYOK key. The factual timeline remains available without it."
        }
        onCancel={onCancel}
      />
      
      {/* Sources Widget */}
      <div style={{ marginTop: "auto" }}>
        <SourcesWidget sources={sources} />
      </div>
    </div>
  )
}

function CollectorSignalsPanel({ chronicle }: { chronicle: ChronicleResponse }) {
  const { collector_signals: signals } = chronicle
  const dominantScope = signals.scope_breakdown.dominant_scope
  const scopeLabel = dominantScope === "collection_level"
    ? "Collection-level"
    : dominantScope === "mixed"
      ? "Mixed"
      : dominantScope === "inscription_level"
        ? "Inscription-level"
        : "No social scope"

  const trendsMention = chronicle.events.find(
    (e) => e.event_type === "social_mention" && e.payload.provider === "google_trends"
  )

  return (
    <section
      style={{
        marginBottom: "var(--space-md)",
        padding: "0.85rem 0.95rem",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-glass)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
        <strong>Collector Signals</strong>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          Attention {signals.attention_score}/100
        </span>
      </div>
      <div style={{ fontSize: "0.9rem", display: "grid", gap: "0.35rem" }}>
        <div>
          Sentiment: <strong>{formatSentiment(signals.sentiment_label)}</strong>
          {" · "}
          Confidence: <strong>{signals.confidence}</strong>
        </div>
        <div>
          Scope: <strong>{scopeLabel}</strong>
          {" · "}
          Evidence: <strong>{signals.evidence_count}</strong>
        </div>
        {signals.sentiment_label === "insufficient_data" && (
          <div style={{ color: "var(--text-secondary)" }}>
            Not enough cross-source evidence yet
          </div>
        )}
        {signals.top_evidence.length > 0 && (
          <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.25rem" }}>
            {signals.top_evidence.slice(0, 3).map((evidence) => (
              <a
                key={`${evidence.provider}:${evidence.url}`}
                href={evidence.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--text-secondary)", textDecoration: "none" }}
              >
                [{platformLabel(evidence.platform)}] {evidence.title}
              </a>
            ))}
          </div>
        )}
        {trendsMention && (
          <div style={{ marginTop: "0.25rem", padding: "0.5rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Google Trends</div>
            <div style={{ whiteSpace: "pre-wrap", color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.4 }}>
              {trendsMention.payload.text}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function CollectorSignalsDebug({
  debugInfo,
}: {
  debugInfo: NonNullable<ChronicleResponse["debug_info"]>["mention_providers"]
}) {
  return (
    <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", display: "grid", gap: "0.75rem" }}>
      {Object.entries(debugInfo ?? {}).map(([provider, debug]) => (
        <ProviderDebugBlock
          key={provider}
          provider={provider as SocialSignalProvider}
          debug={debug as MentionProviderDebug}
        />
      ))}
    </div>
  )
}

function ProviderDebugBlock({
  provider,
  debug,
}: {
  provider: SocialSignalProvider
  debug: MentionProviderDebug
}) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <div><strong>{providerLabel(provider)}</strong></div>
      <div>Collection: {debug.collection_name ?? "unknown"}</div>
      <div>Item: {debug.item_name ?? "unknown"}</div>
      {debug.official_x_urls && (
        <div>Seed profiles: {debug.official_x_urls.length > 0 ? debug.official_x_urls.join(", ") : "none"}</div>
      )}
      {debug.candidate_handles && (
        <div>Candidate handles: {debug.candidate_handles.length > 0 ? debug.candidate_handles.join(", ") : "none"}</div>
      )}
      <div>Queries:</div>
      {debug.queries.map((query) => (
        <code key={`${provider}-${query}`} style={{ whiteSpace: "pre-wrap" }}>{query}</code>
      ))}
      <div>Attempts:</div>
      {debug.attempts.map((attempt, index) => (
        <code key={`${provider}-${attempt.query}-${index}`} style={{ whiteSpace: "pre-wrap" }}>
          {attempt.target ? `${attempt.target} · ` : ""}
          {attempt.outcome} · {attempt.status ?? "-"} · {attempt.result_count ?? 0} · {attempt.query}
        </code>
      ))}
      {debug.notes.map((note, index) => (
        <code key={`${provider}-note-${index}`} style={{ whiteSpace: "pre-wrap" }}>
          note · {note}
        </code>
      ))}
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
  const mempoolEntries = sourceCatalog.filter(
    (source) => source.trust_level === "bitcoin_indexer"
  )
  const socialEntries = sourceCatalog.filter(
    (source) => source.trust_level === "public_social"
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
    detail: (chronicle.collection_context.presentation.full_label ?? chronicle.collection_context.presentation.item_label ?? chronicle.collection_context.presentation.primary_label)
      ? `Metadata + provenance for ${chronicle.collection_context.presentation.full_label ?? chronicle.collection_context.presentation.item_label ?? chronicle.collection_context.presentation.primary_label}`
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
    status: mempoolEntries.some((entry) => !entry.partial) ? "success" : "partial",
    detail: transferCount > 0
      ? `${transferCount} transfer${transferCount > 1 ? "s" : ""} found`
      : mempoolEntries.length > 0
        ? "Genesis and current output checked"
        : "No transfers detected",
    cached: chronicle.from_cache,
    count: mempoolEntries.length > 0 ? mempoolEntries.length : transferCount,
    links: [
      ...mempoolEntries.map((entry) => ({ label: entry.source_type, url: entry.url_or_ref })),
      ...events
      .filter((e) => e.event_type === "transfer" || e.event_type === "sale")
      .map((e) => ({
        label: `${e.event_type} tx`,
        url: e.source.ref.startsWith("http") ? e.source.ref : `https://mempool.space/tx/${e.source.ref.split(":")[0]}`
      }))
    ]
  })

  const mentionCount = events.filter((e) => e.event_type === "social_mention").length
  const collectorSignals = chronicle.collector_signals
  sources.push({
    name: "Collector signals",
    status: mentionCount > 0 ? "success" : "partial",
    detail: mentionCount > 0
      ? `${mentionCount} mention${mentionCount > 1 ? "s" : ""} found · ${formatSentiment(collectorSignals.sentiment_label)}`
      : "Not enough cross-source evidence yet",
    cached: chronicle.from_cache,
    count: mentionCount,
    links: [
      ...events
        .filter((e) => e.event_type === "social_mention")
        .map((e, i) => ({
          label: e.description ? (e.description.length > 30 ? e.description.substring(0, 30) + "..." : e.description) : `Mention ${i + 1}`,
          url: e.source.ref
        })),
      ...socialEntries.map((entry) => ({
        label: entry.source_type,
        url: entry.url_or_ref,
      })),
    ]
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
    const rarityOverlay = marketMatch?.rarity_overlay
    const rarityDetail = rarityOverlay
      ? ` · ${rarityOverlay.source === "satflow" ? "Satflow" : "ord.net"} rarity · ${rarityOverlay.traits.length} traits`
      : ""
    sources.push({
      name: marketSourceName,
      status: marketEntries.some((entry) => !entry.partial) ? "success" : "partial",
      detail: marketMatch
        ? `${marketMatch.collection_name} · ${marketMatch.verified ? "verified" : "overlay"}${rarityDetail}`
        : "Public market overlay",
      cached: chronicle.from_cache,
      count: marketEntries.length,
      links: marketEntries.map((e) => ({ label: e.source_type, url: e.url_or_ref }))
    })
  }

  // UniSat enrichment
  const unisatEntries = sourceCatalog.filter(
    (source) => source.trust_level === "unisat_indexer"
  )
  if (unisatEntries.length > 0) {
    sources.push({
      name: "unisat.io",
      status: unisatEntries.some((entry) => !entry.partial) ? "success" : "partial",
      detail: "Indexer inscription data",
      cached: chronicle.from_cache,
      count: unisatEntries.length,
      links: unisatEntries.map((e) => ({ label: e.source_type, url: e.url_or_ref }))
    })
  }

  return sources
}

function formatSentiment(sentiment: ChronicleResponse["collector_signals"]["sentiment_label"]): string {
  if (sentiment === "insufficient_data") return "Insufficient data"
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1)
}

function platformLabel(platform: ChronicleResponse["collector_signals"]["top_evidence"][number]["platform"]): string {
  switch (platform) {
    case "nostr":
      return "Nostr"
    case "x":
      return "X"
    case "google_trends":
      return "Trends"
    default:
      return "Social"
  }
}

function providerLabel(provider: SocialSignalProvider): string {
  switch (provider) {
    case "google_trends":
      return "Google Trends"
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
}
