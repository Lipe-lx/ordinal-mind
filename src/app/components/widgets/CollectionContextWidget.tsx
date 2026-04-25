import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import type { CollectionContext, RelatedInscriptionSummary } from "../../lib/types"

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
  const { presentation, protocol, registry } = collectionContext
  const hasContent =
    presentation.facets.length > 0 ||
    (protocol.parents?.items.length ?? 0) > 0 ||
    (protocol.children?.items.length ?? 0) > 0 ||
    (protocol.gallery?.items.length ?? 0) > 0 ||
    registry.issues.length > 0

  if (!hasContent) return null

  // Derive the primary badge text from presentation or first curated facet
  const primaryBadge = presentation.primary_label
    ?? presentation.facets.find((f) => f.tone === "curated" || f.tone === "canonical")?.value
    ?? null

  // Remaining facets (skip the one already shown in the badge)
  const detailFacets = primaryBadge
    ? presentation.facets.filter((f) => f.value !== primaryBadge)
    : presentation.facets

  // Collect all relation groups into a flat structure for inline rendering
  const relationGroups: { icon: string; label: string; items: RelatedInscriptionSummary[]; partial: boolean }[] = []
  if ((protocol.parents?.items.length ?? 0) > 0) {
    relationGroups.push({ icon: "⬆", label: "Parent", items: protocol.parents?.items ?? [], partial: protocol.parents?.partial ?? false })
  }
  if ((protocol.children?.items.length ?? 0) > 0) {
    relationGroups.push({ icon: "⬇", label: "Children", items: protocol.children?.items ?? [], partial: protocol.children?.partial ?? false })
  }
  if ((protocol.gallery?.items.length ?? 0) > 0) {
    relationGroups.push({ icon: "🖼", label: "Gallery", items: protocol.gallery?.items ?? [], partial: protocol.gallery?.partial ?? false })
  }

  const hasDetails = detailFacets.length > 0 || relationGroups.length > 0

  return (
    <div className={`widget-provenance ${expanded ? "expanded" : ""}`}>
      <div
        className="widget-provenance-header"
        onClick={() => hasDetails && setExpanded(!expanded)}
        style={{ cursor: hasDetails ? "pointer" : "default" }}
      >
        <div className="widget-provenance-header-left">
          {primaryBadge && (
            <span className="widget-provenance-badge">
              <span className="widget-provenance-badge-icon">✓</span>
              {primaryBadge}
            </span>
          )}
          <span className="widget-provenance-title">Provenance &amp; Collections</span>
          {registry.issues.map((issue) => (
            <IssueBadge key={issue} issue={issue} />
          ))}
        </div>
        {hasDetails && (
          <span className="widget-provenance-expander">
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </div>

      {expanded && (
        <div className="widget-provenance-flow">
          {/* Detail facets as inline pills */}
          {detailFacets.map((facet) => (
            <div
              key={`${facet.label}-${facet.value}`}
              className={`widget-provenance-pill tone-${facet.tone}`}
              title={facet.detail}
            >
              <span className="widget-provenance-pill-label">{facet.label}</span>
              <span className="widget-provenance-pill-value">{facet.value}</span>
            </div>
          ))}

          {/* Relation groups as inline pills */}
          {relationGroups.map((group) => (
            <div key={group.label} className="widget-provenance-pill tone-canonical">
              <span className="widget-provenance-pill-icon">{group.icon}</span>
              <span className="widget-provenance-pill-label">{group.label}</span>
              <span className="widget-provenance-pill-value">
                {group.items.slice(0, 3).map((item, i) => (
                  <a
                    key={item.inscription_id}
                    className="widget-provenance-pill-link"
                    href={`https://ordinals.com/inscription/${item.inscription_id}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.inscription_number != null ? `#${item.inscription_number}` : "?"}
                    {i < Math.min(group.items.length, 3) - 1 && ", "}
                  </a>
                ))}
                {group.partial && <span className="widget-provenance-pill-partial">…</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

