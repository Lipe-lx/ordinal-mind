import { useState, useMemo } from "react"
import { KeyStore } from "../lib/byok"
import type { ResearchLog } from "../lib/byok/toolExecutor"
import { SourcesWidget, type DataSource } from "./widgets/SourcesWidget"
import { NarrativeChatRenderer } from "./NarrativeChatRenderer"
import type { ChronicleResponse, MentionProviderDebug, SocialSignalProvider } from "../lib/types"
import type { SynthesisPhase } from "../lib/byok/useChronicleNarrativeChat"
import type { WikiActivityStatus } from "../lib/byok/useChronicleNarrativeChat"
import type { SynthesisMode } from "../lib/byok/context"
import { GenealogyTree } from "./GenealogyTree"
import type { ChatMessage, ChatThreadSummary } from "../lib/byok/chatTypes"

interface Props {
  chronicle: ChronicleResponse
  messages: ChatMessage[]
  activeThreadId: string | null
  threadHistory: ChatThreadSummary[]
  streamingText: string
  streamingThought: string
  phase: SynthesisPhase
  elapsed: number
  synthError: string | null
  inputError: string | null
  lastInputMode: SynthesisMode | null
  wikiStatusLabel: string
  wikiStatusError: string | null
  wikiActivity: WikiActivityStatus | null
  researchLogs: ResearchLog[]
  onSendMessage: (prompt: string) => Promise<void> | void
  onEditMessage: (messageId: string, content: string) => Promise<void> | void
  onNewThread: () => void
  onResumeThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => boolean
  onDeleteThread: (threadId: string) => boolean
  onRetryMessage: () => Promise<void> | void
  onOpenBYOK: () => void
  onCancel: () => void
}

export function ChronicleCard({
  chronicle,
  messages,
  activeThreadId,
  threadHistory,
  streamingText,
  streamingThought,
  phase,
  elapsed,
  synthError,
  inputError,
  lastInputMode,
  wikiStatusLabel,
  wikiStatusError,
  wikiActivity,
  researchLogs,
  onSendMessage,
  onEditMessage,
  onNewThread,
  onResumeThread,
  onRenameThread,
  onDeleteThread,
  onRetryMessage,
  onOpenBYOK,
  onCancel,
}: Props) {
  const hasKey = KeyStore.has()
  const config = KeyStore.get()

  // Built data sources from chronicle response metadata
  const sources = buildDataSources(chronicle)
  const [layoutMode, setLayoutMode] = useState<"split" | "narrative" | "genealogy">("split")

  const toggleExpand = (target: "narrative" | "genealogy") => {
    if (layoutMode === target) {
      setLayoutMode("split")
    } else {
      setLayoutMode(target)
    }
  }

  return (
    <div className={`chronicle-card glass-card layout-mode-${layoutMode}`}>
      {chronicle.collector_signals.evidence_count > 0 && (
        <CollectorSignalsPanel chronicle={chronicle} />
      )}
      {chronicle.debug_info?.mention_providers && (
        <details style={{ marginBottom: "var(--space-md)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: "0.5rem" }}>
            Collector signals debug
          </summary>
          <CollectorSignalsDebug debugInfo={chronicle.debug_info.mention_providers} />
        </details>
      )}

      {/* Tab Switcher / Expansion Toggles */}
      <div className="chronicle-tabs">
        <button 
          className={`chronicle-tab ${layoutMode === "narrative" ? "active is-expanded" : ""}`}
          onClick={() => toggleExpand("narrative")}
        >
          <span>Chronicle Narrative</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="tab-arrow is-right">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button 
          className={`chronicle-tab ${layoutMode === "genealogy" ? "active is-expanded" : ""}`}
          onClick={() => toggleExpand("genealogy")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="tab-arrow is-left">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Genealogical Tree</span>
        </button>
      </div>

      <div className={`chronicle-layout-wrapper layout-mode-${layoutMode}`}>
        <div className="chronicle-layout-panel is-narrative">
          <NarrativeChatRenderer
            messages={messages}
            activeThreadId={activeThreadId}
            threadHistory={threadHistory}
            streamingText={streamingText}
            streamingThought={streamingThought}
            phase={phase}
            elapsed={elapsed}
            providerName={config?.provider}
            modelName={config?.model}
            error={synthError}
            inputError={inputError}
            inputMode={lastInputMode}
            wikiStatusLabel={wikiStatusLabel}
            wikiStatusError={wikiStatusError}
            wikiActivity={wikiActivity}
            researchLogs={researchLogs}
            hasKey={hasKey}
            onSend={onSendMessage}
            onEdit={onEditMessage}
            onNewThread={onNewThread}
            onResumeThread={onResumeThread}
            onRenameThread={onRenameThread}
            onDeleteThread={onDeleteThread}
            onRetry={onRetryMessage}
            onCancel={onCancel}
            onOpenBYOK={onOpenBYOK}
            collectionSlug={chronicle.collection_context.market.ord_net_match?.collection_slug ?? chronicle.collection_context.market.satflow_match?.collection_slug}
          />
        </div>
        <div className="chronicle-layout-panel is-genealogy">
          <GenealogyTree chronicle={chronicle} />
        </div>
      </div>
      
      {/* Sources Widget */}
      <div style={{ marginTop: "auto" }}>
        <SourcesWidget sources={sources} />
      </div>
    </div>
  )
}

function CollectorSignalsPanel({ chronicle }: { chronicle: ChronicleResponse }) {
  const { collector_signals: signals } = chronicle
  const [currentPage, setCurrentPage] = useState(0)
  const [expanded, setExpanded] = useState(false)

  const dominantScope = signals.scope_breakdown.dominant_scope
  const scopeLabel = dominantScope === "collection_level"
    ? "Collection"
    : dominantScope === "mixed"
      ? "Mixed"
      : dominantScope === "inscription_level"
        ? "Inscription"
        : "None"

  const trendsMention = chronicle.events.find(
    (e) => e.event_type === "social_mention" && e.payload.provider === "google_trends"
  )

  // Pagination logic
  const itemsPerPage = 3
  const evidenceChunks = useMemo(() => {
    const chunks = []
    for (let i = 0; i < signals.top_evidence.length; i += itemsPerPage) {
      chunks.push(signals.top_evidence.slice(i, i + itemsPerPage))
    }
    return chunks
  }, [signals.top_evidence])

  const totalPages = 1 + evidenceChunks.length

  const goToNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentPage((p) => Math.min(p + 1, totalPages - 1))
  }
  const goToPrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentPage((p) => Math.max(p - 1, 0))
  }

  return (
    <section className={`signals-panel ${expanded ? "expanded" : ""}`}>
      <button 
        type="button"
        className="signals-header" 
        onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}
      >
        <div className="signals-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          Collector Signals
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div className="signals-attention">
            {signals.attention_score} Attention
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease-out",
              color: "var(--text-tertiary)"
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {expanded && (
        <>
          <div key={currentPage} className="signals-content" style={{ marginTop: "0.75rem" }}>
            {currentPage === 0 ? (
              <>
                <div className="signals-grid">
                  <div className="signals-metric">
                    <div className="signals-metric-label">Sentiment</div>
                    <div className="signals-metric-value">{formatSentiment(signals.sentiment_label)}</div>
                  </div>
                  <div className="signals-metric">
                    <div className="signals-metric-label">Scope</div>
                    <div className="signals-metric-value">{scopeLabel}</div>
                  </div>
                  <div className="signals-metric">
                    <div className="signals-metric-label">Confidence</div>
                    <div className="signals-metric-value">{signals.confidence.toUpperCase()}</div>
                  </div>
                  <div className="signals-metric">
                    <div className="signals-metric-label">Evidence</div>
                    <div className="signals-metric-value">{signals.evidence_count} items</div>
                  </div>
                </div>
                {trendsMention && (
                  <div className="signals-trends-preview" title={trendsMention.payload.text}>
                    {trendsMention.payload.text}
                  </div>
                )}
                {!trendsMention && signals.sentiment_label === "insufficient_data" && (
                  <div style={{ color: "var(--text-tertiary)", fontSize: "0.8rem", fontStyle: "italic", textAlign: "center", marginTop: "0.5rem" }}>
                    Awaiting more cross-source data...
                  </div>
                )}
              </>
            ) : (
              <div className="signals-evidence-list">
                {evidenceChunks[currentPage - 1]?.map((evidence) => (
                  <a
                    key={`${evidence.provider}:${evidence.url}`}
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="signals-evidence-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="signals-evidence-meta">
                      <span className="signals-platform-tag">{platformLabel(evidence.platform)}</span>
                      <span style={{ color: "var(--text-tertiary)", fontSize: "0.65rem" }}>
                        {new Date(evidence.published_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="signals-evidence-title">{evidence.title}</div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <footer className="signals-nav">
              <button 
                className="signals-nav-btn" 
                onClick={goToPrev} 
                disabled={currentPage === 0}
              >
                ← Prev
              </button>
              <div className="signals-page-dots">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <div key={i} className={`signals-dot ${i === currentPage ? "active" : ""}`} />
                ))}
              </div>
              <button 
                className="signals-nav-btn" 
                onClick={goToNext} 
                disabled={currentPage === totalPages - 1}
              >
                Next →
              </button>
            </footer>
          )}
        </>
      )}
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
  if (mentionCount > 0) {
    sources.push({
      name: "Collector signals",
      status: "success",
      detail: `${mentionCount} mention${mentionCount > 1 ? "s" : ""} found · ${formatSentiment(collectorSignals.sentiment_label)}`,
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
  }

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
    case "x":
      return "X"
    case "google_trends":
      return "Trends"
    default:
      return "Social"
  }
}

function providerLabel(provider: SocialSignalProvider): string {
  if (provider === "google_trends") return "Google Trends"
  return provider
}
