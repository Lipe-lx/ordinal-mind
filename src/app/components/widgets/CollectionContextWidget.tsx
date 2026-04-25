import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import type { CollectionContext, CollectionPresentationFacet, RelatedInscriptionSummary } from "../../lib/types"

interface Props {
  collectionContext: CollectionContext
}

// Tooltip rendered into document.body via Portal — escapes all stacking contexts
function PortalTooltip({ text, anchorRef, visible }: {
  text: string
  anchorRef: React.RefObject<HTMLElement | null>
  visible: boolean
}) {
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (visible && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top + window.scrollY - 8,
        left: rect.left + window.scrollX + rect.width / 2,
      })
    }
  }, [visible, anchorRef])

  if (!visible) return null

  return createPortal(
    <div
      className="portal-tooltip"
      style={{
        position: "absolute",
        top: coords.top,
        left: coords.left,
        transform: "translate(-50%, -100%)",
        zIndex: 99999,
      }}
    >
      {text}
      <span className="portal-tooltip-arrow" />
    </div>,
    document.body
  )
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

export function CollectionContextWidget({ collectionContext }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { presentation, protocol, registry, market, profile } = collectionContext
  const hasContent =
    presentation.facets.length > 0 ||
    (protocol.parents?.items.length ?? 0) > 0 ||
    (protocol.children?.items.length ?? 0) > 0 ||
    (protocol.gallery?.items.length ?? 0) > 0 ||
    registry.issues.length > 0 ||
    Boolean(profile)

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
    Boolean(profile?.collector_signals.length)

  const evidenceCount = [
    registry.match ? "registry" : null,
    relationGroups.length > 0 ? "on-chain relations" : null,
    market.match ? "market overlay" : null,
    profile ? "collection profile" : null,
  ].filter(Boolean).length

  const summaryText = buildSummaryText({
    registryQuality: registry.match?.quality_state,
    hasParent: (protocol.parents?.items.length ?? 0) > 0,
    hasMarket: Boolean(market.match),
    hasProfile: Boolean(profile),
  })

  return (
    <div className={`widget-provenance ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="widget-provenance-header"
        onClick={() => hasDetails && setExpanded(!expanded)}
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
            {evidenceCount} evidence layer{evidenceCount === 1 ? "" : "s"}
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
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease-out"
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="widget-provenance-body">


          {(identityFacets.length > 0 || registry.match || relationGroups.length > 0) && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Verified identity</span>
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: (identityFacets.length > 0 || registry.match) && relationGroups.length > 0 ? "1fr 1fr" : "1fr", 
                gap: "16px", 
                alignItems: "start" 
              }}>
                {(identityFacets.length > 0 || registry.match) && (
                  <div>
                    {registry.match && (
                      <EvidenceRow
                        label="Curated registry"
                        value={registry.match.matched_collection}
                        detail={`${registry.match.quality_state.replace("_", " ")} · ${registry.match.match_type} match`}
                        tone="curated"
                      />
                    )}
                    {identityFacets.map((facet) => (
                      <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} />
                    ))}
                  </div>
                )}

                {relationGroups.length > 0 && (
                  <div>
                    {relationGroups.map((group) => (
                      <RelationRow key={group.label} group={group} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {(marketFacets.length > 0 || market.match || marketSignals.length > 0) && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Market &amp; collector signals</span>
              {market.ord_net_match && (
                <EvidenceRow
                  label={market.ord_net_match.verified ? "ord.net verified overlay" : "ord.net overlay"}
                  value={market.ord_net_match.collection_name}
                  detail={market.ord_net_match.item_name ?? market.ord_net_match.collection_slug}
                  tone="overlay"
                />
              )}
              {market.satflow_match && (
                <EvidenceRow
                  label="Satflow overlay"
                  value={market.satflow_match.collection_name}
                  detail={market.satflow_match.item_name ?? market.satflow_match.collection_slug}
                  tone="overlay"
                />
              )}
              {marketFacets.map((facet) => (
                <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} />
              ))}
              {marketSignals.slice(0, 4).map((signal) => (
                <EvidenceRow
                  key={`${signal.label}-${signal.value}`}
                  label={signal.label}
                  value={signal.value}
                  detail={shortenSource(signal.source_ref)}
                  tone="overlay"
                  href={signal.source_ref}
                />
              ))}
            </section>
          )}

          {partialFacets.length > 0 && (
            <section className="widget-provenance-section">
              <span className="widget-provenance-section-label">Caveats</span>
              {partialFacets.map((facet) => (
                <EvidenceRow key={`${facet.label}-${facet.value}`} {...facet} />
              ))}
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

function EvidenceRow({ label, value, detail, tone, href }: CollectionPresentationFacet & { href?: string }) {
  return (
    <div className={`widget-provenance-row tone-${tone}`}>
      <span className="widget-provenance-row-marker" />
      <div className="widget-provenance-row-copy">
        <span className="widget-provenance-row-label">{label}</span>
        <span className="widget-provenance-row-value">{value}</span>
        {detail && <span className="widget-provenance-row-detail">{detail}</span>}
        {href && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
            <a 
              href={href} 
              target="_blank" 
              rel="noreferrer" 
              style={{ 
                fontSize: "0.625rem", 
                color: "var(--accent-primary)", 
                textDecoration: "none", 
                display: "inline-flex", 
                alignItems: "center", 
                gap: "4px", 
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: "4px",
                background: "rgba(247, 147, 26, 0.08)",
                border: "1px solid rgba(247, 147, 26, 0.2)",
                transition: "background 0.2s"
              }}
            >
              Open collection <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function RelationRow({ group }: { group: RelationGroup }) {
  return (
    <div className="widget-provenance-row tone-canonical">
      <span className="widget-provenance-row-marker" />
      <div className="widget-provenance-row-copy">
        <span className="widget-provenance-row-label">{group.label}</span>
        <span className="widget-provenance-row-value">{group.description}</span>
        <span className="widget-provenance-relation-list">
          {group.items.slice(0, 4).map((item) => (
            <a
              key={item.inscription_id}
              className="widget-provenance-relation-link"
              href={`https://ordinals.com/inscription/${item.inscription_id}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {item.inscription_number != null ? `#${item.inscription_number}` : shortenInscription(item.inscription_id)}
            </a>
          ))}
          {group.partial && <span className="widget-provenance-row-detail">sampled result</span>}
          {group.sourceRef && (
            <a
              className="widget-provenance-source-link"
              href={group.sourceRef}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              source
            </a>
          )}
        </span>
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
