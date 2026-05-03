import { useState, useRef } from "react"
import { PortalTooltip } from "../Tooltip"
import type { CollectionContext, CollectionPresentationFacet, RelatedInscriptionSummary } from "../../lib/types"
import { formatChronicleText as linkifyBrands } from "../../lib/formatters"

interface Props {
  collectionContext: CollectionContext
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
}

function IssueBadge({ issue }: { issue: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <>
      <span
        ref={ref}
        className="widget-provenance-note-badge"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        ⚠
      </span>
      <PortalTooltip text={issue} anchorRef={ref} visible={visible} />
    </>
  )
}

function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <>
      <span
        ref={ref}
        className="widget-info-icon"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </span>
      <PortalTooltip text={text} anchorRef={ref} visible={visible} />
    </>
  )
}

export function CollectionContextWidget({ collectionContext, expanded: externalExpanded, onToggle }: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = externalExpanded !== undefined ? externalExpanded : internalExpanded
  const setExpanded = (val: boolean) => {
    if (onToggle) onToggle(val)
    else setInternalExpanded(val)
  }
  const { presentation, protocol, registry, market, profile } = collectionContext
  const hasContent =
    presentation.facets.length > 0 ||
    (protocol.parents?.items.length ?? 0) > 0 ||
    (protocol.children?.items.length ?? 0) > 0 ||
    (protocol.gallery?.items.length ?? 0) > 0 ||
    registry.issues.length > 0 ||
    Boolean(profile) ||
    collectionContext.socials.official_x_profiles.length > 0

  if (!hasContent) return null

  // Derive the primary badge text from presentation or first curated facet
  const primaryBadge = presentation.full_label
    ?? presentation.item_label
    ?? presentation.primary_label
    ?? presentation.facets.find((f) => f.tone === "curated" || f.tone === "canonical")?.value
    ?? null

  const primaryFacetIndex = primaryBadge
    ? presentation.facets.findIndex((f) =>
        f.value === primaryBadge && (f.tone === "curated" || f.tone === "canonical")
      )
    : -1
  const detailFacets = presentation.facets.filter((_, index) => index !== primaryFacetIndex)

  const relationGroups: RelationGroup[] = []
  if ((protocol.parents?.items.length ?? 0) > 0) {
    relationGroups.push({
      label: "Parent provenance",
      description: "Protocol-native parent link found through ordinals.com recursive endpoints.",
      items: protocol.parents?.items ?? [],
      partial: protocol.parents?.partial ?? false,
      sourceRef: protocol.parents?.source_ref,
    })
  }
  if ((protocol.children?.items.length ?? 0) > 0) {
    relationGroups.push({
      label: "Children",
      description: "Child inscriptions discovered from the protocol relation endpoint.",
      items: protocol.children?.items ?? [],
      partial: protocol.children?.partial ?? false,
      sourceRef: protocol.children?.source_ref,
    })
  }
  if ((protocol.gallery?.items.length ?? 0) > 0) {
    relationGroups.push({
      label: "Gallery sample",
      description: "Gallery membership sample returned by the ord server.",
      items: protocol.gallery?.items ?? [],
      partial: protocol.gallery?.partial ?? false,
      sourceRef: protocol.gallery?.source_ref,
    })
  }

  const identityFacets = detailFacets.filter((facet) => facet.tone === "curated" || facet.tone === "canonical")
  const marketFacets = detailFacets.filter((facet) => facet.tone === "overlay").filter(facet => {
    if (facet.label === "Satflow overlay" || facet.label === "ord.net overlay" || facet.label === "ord.net verified overlay") {
      return false
    }
    // Hide market stats if they were scraped incorrectly as text instead of numbers
    if (facet.label === "Market supply" || facet.label === "Listed") {
      return /\d/.test(facet.value)
    }
    return true
  })

  const partialFacets = detailFacets.filter((facet) => facet.tone === "partial")
  const marketSignals = (profile?.collector_signals ?? []).filter((signal) =>
    signal.label === "Satflow collection market" || signal.label === "ord.net collection directory"
  ).filter(signal => {
    if (signal.label === "Satflow collection market") {
      return /\d/.test(signal.value)
    }
    return true
  })
  const hasDetails =
    detailFacets.length > 0 ||
    relationGroups.length > 0 ||
    Boolean(profile?.collector_signals.length) ||
    collectionContext.socials.official_x_profiles.length > 0

  const activeSlug = market.ord_net_match?.collection_slug ?? market.satflow_match?.collection_slug

  const evidenceCount = [
    registry.match ? "registry" : null,
    relationGroups.length > 0 ? "on-chain relations" : null,
    market.match ? "market overlay" : null,
    profile ? "collection profile" : null,
    collectionContext.socials.official_x_profiles.length > 0 ? "official social" : null,
  ].filter(Boolean).length

  const summaryText = buildSummaryText({
    registryQuality: registry.match?.quality_state,
    hasParent: (protocol.parents?.items.length ?? 0) > 0,
    hasMarket: Boolean(market.match),
    hasProfile: Boolean(profile),
  })

  return (
    <div className={`widget-provenance ${isExpanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="widget-provenance-header"
        onClick={() => hasDetails && setExpanded(!isExpanded)}
        disabled={!hasDetails}
      >
        <div className="widget-provenance-header-left">
          <span className="widget-provenance-kicker">Provenance &amp; Collections</span>
          <span className="widget-provenance-heading">
            {primaryBadge ?? "Collection context found"}
          </span>
          <span className="widget-provenance-summary">{summaryText}</span>
          {registry.issues.map((issue) => (
            <IssueBadge key={issue} issue={issue} />
          ))}
        </div>
        <div className="widget-provenance-header-right">
          <span className="widget-provenance-evidence-count">
            {evidenceCount}
          </span>
          {hasDetails && (
            <span 
              className="widget-provenance-expander" 
              style={{ padding: "4px 6px", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease-out"
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="widget-provenance-body">


          {(identityFacets.length > 0 || registry.match || relationGroups.length > 0) && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Verified identity</span>
              <div className="widget-meta-grid" style={{ 
                gridTemplateColumns: (identityFacets.length > 0 || registry.match) && relationGroups.length > 0 ? "repeat(2, minmax(0, 1fr))" : "1fr", 
                gap: "1px" 
              }}>
                {(identityFacets.length > 0 || registry.match) && (
                  <>
                    {registry.match && (
                      <EvidenceRow
                        label="Curated registry"
                        value={registry.match.matched_collection}
                        detail={`${registry.match.quality_state.replace("_", " ")} · ${registry.match.match_type} match`}
                        tone="curated"
                        activeSlug={activeSlug}
                      />
                    )}
                    {identityFacets.map((facet) => (
                      <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} activeSlug={activeSlug} />
                    ))}
                  </>
                )}

                {relationGroups.length > 0 && (
                  <>
                    {relationGroups.map((group) => (
                      <RelationRow key={group.label} group={group} activeSlug={activeSlug} />
                    ))}
                  </>
                )}
              </div>
            </section>
          )}

          {(marketFacets.length > 0 || market.match || marketSignals.length > 0 || collectionContext.socials.official_x_profiles.length > 0) && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Market &amp; collector signals</span>
              <div className="widget-meta-grid" style={{ gap: "1px" }}>
                {market.ord_net_match && (
                  <EvidenceRow
                    label={market.ord_net_match.verified ? "ord.net verified overlay" : "ord.net overlay"}
                    value={market.ord_net_match.collection_name}
                    detail={market.ord_net_match.item_name ?? market.ord_net_match.collection_slug}
                    tone="overlay"
                    activeSlug={activeSlug}
                  />
                )}
                {market.satflow_match && (
                  <EvidenceRow
                    label="Satflow overlay"
                    value={market.satflow_match.collection_name}
                    detail={market.satflow_match.item_name ?? market.satflow_match.collection_slug}
                    tone="overlay"
                    activeSlug={activeSlug}
                  />
                )}
                {collectionContext.socials.official_x_profiles.map((profileLink) => (
                  <EvidenceRow
                    key={profileLink.url}
                    label="Official X account"
                    value={formatXHandle(profileLink.url)}
                    tone="overlay"
                    href={profileLink.url}
                    activeSlug={activeSlug}
                  />
                ))}
                {marketFacets.map((facet) => (
                  <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} activeSlug={activeSlug} />
                ))}
                {marketSignals.slice(0, 4).map((signal) => {
                  if (signal.label === "Satflow collection market") {
                    const metrics = signal.value.split(" · ")
                    return (
                      <div key="satflow-stats" className="widget-meta-cell" style={{ 
                        display: "flex", 
                        flexDirection: "column",
                        gap: "4px",
                        padding: "6px 12px",
                        gridColumn: "span 2"
                      }}>
                        <span className="widget-meta-label">Market</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {metrics.map((m, i) => {
                            const lastSpace = m.lastIndexOf(" ")
                            const label = lastSpace !== -1 ? m.substring(0, lastSpace) : m
                            const value = lastSpace !== -1 ? m.substring(lastSpace + 1) : "—"
                            return (
                              <div key={i} style={{ 
                                display: "flex", 
                                alignItems: "baseline", 
                                gap: "3px",
                                padding: "1px 4px",
                                background: "rgba(255, 255, 255, 0.04)",
                                borderRadius: "3px",
                                border: "1px solid rgba(255, 255, 255, 0.06)"
                              }}>
                                <span style={{ fontSize: "0.5rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase" }}>{linkifyBrands(label, activeSlug)}</span>
                                <span style={{ fontSize: "0.688rem", fontWeight: 600, color: "var(--accent-primary)", fontFamily: "var(--font-mono)" }}>{linkifyBrands(value, activeSlug)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  }
                  
                  // Specific handling for ord.net directory to ensure correct URL format
                  if (signal.label === "ord.net collection directory") {
                    let url = signal.source_ref
                    if ((!url || url.includes("index")) && market.ord_net_match?.collection_slug) {
                      url = `https://ord.net/collection/${market.ord_net_match.collection_slug}`
                    }
                    return (
                      <EvidenceRow
                        key={`${signal.label}-${signal.value}`}
                        label={signal.label}
                        value={signal.value}
                        tone="overlay"
                        href={url}
                        activeSlug={activeSlug}
                      />
                    )
                  }

                  return (
                    <EvidenceRow
                      key={`${signal.label}-${signal.value}`}
                      label={signal.label}
                      value={signal.value}
                      detail={shortenSource(signal.source_ref)}
                      tone="overlay"
                      href={signal.source_ref}
                      activeSlug={activeSlug}
                    />
                  )
                })}

              </div>
            </section>
          )}

          {partialFacets.length > 0 && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Caveats</span>
              <div className="widget-meta-grid" style={{ gap: "1px" }}>
                {partialFacets.map((facet) => (
                  <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} activeSlug={activeSlug} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

interface RelationGroup {
  label: string
  description: string
  items: RelatedInscriptionSummary[]
  partial: boolean
  sourceRef?: string
}

function EvidenceRow({
  label,
  value,
  detail,
  tone,
  href,
  activeSlug,
}: CollectionPresentationFacet & { href?: string; activeSlug?: string }) {
  return (
    <div className={`widget-meta-cell tone-${tone}`}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <span className="widget-meta-label" style={{ marginBottom: 0 }}>
          {linkifyBrands(label, activeSlug)}
        </span>
        {detail && <InfoTooltip text={detail} />}
      </div>
      <span className="widget-meta-value">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="brand-link" style={{ color: "inherit" }}>
            {linkifyBrands(value, activeSlug)}
          </a>
        ) : (
          linkifyBrands(value, activeSlug)
        )}
      </span>
    </div>
  )
}

function RelationRow({ group, activeSlug }: { group: RelationGroup, activeSlug?: string }) {
  return (
    <div className="widget-meta-cell tone-canonical">
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <span className="widget-meta-label" style={{ marginBottom: 0 }}>
          {linkifyBrands(group.label, activeSlug)}
        </span>
        <InfoTooltip text={group.description} />
      </div>
      <div className="widget-provenance-relation-list">
        {group.items.slice(0, 4).map((item) => (
          <a
            key={item.inscription_id}
            className="widget-provenance-relation-link"
            href={`https://ordinals.com/inscription/${item.inscription_id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: "0.625rem", padding: "1px 4px" }}
          >
            {item.inscription_number != null ? `#${item.inscription_number}` : shortenInscription(item.inscription_id)}
            {item.genesis_timestamp && (
              <span className="widget-provenance-relation-date">
                ({new Date(item.genesis_timestamp).getFullYear()})
              </span>
            )}
          </a>
        ))}
        {group.partial && <span className="widget-meta-sub">sampled result</span>}
      </div>
    </div>
  )
}

function buildSummaryText(args: {
  registryQuality?: string
  hasParent: boolean
  hasMarket: boolean
  hasProfile: boolean
}): string {
  if (args.hasParent) return "Protocol parent relation found, with supporting collection context."
  if (args.registryQuality === "verified") return "Verified public registry match with marketplace context."
  if (args.hasProfile) return "Collection profile found from source-backed public research."
  if (args.hasMarket) return "Marketplace collection overlay found; not an on-chain provenance claim."
  return "Public collection context is available for review."
}

function shortenSource(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, "")
  } catch {
    return source
  }
}

function shortenInscription(id: string): string {
  return `${id.slice(0, 8)}...${id.slice(-3)}`
}

function formatXHandle(url: string): string {
  try {
    const parsed = new URL(url)
    const handle = parsed.pathname.split("/").filter(Boolean)[0]
    return handle ? `@${handle}` : url
  } catch {
    return url
  }
}
