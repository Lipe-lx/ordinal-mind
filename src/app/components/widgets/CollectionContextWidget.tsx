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
  const { presentation, protocol, registry } = collectionContext
  const hasContent =
    presentation.facets.length > 0 ||
    (protocol.parents?.items.length ?? 0) > 0 ||
    (protocol.children?.items.length ?? 0) > 0 ||
    (protocol.gallery?.items.length ?? 0) > 0 ||
    registry.issues.length > 0

  if (!hasContent) return null

  return (
    <div className="widget-provenance">
      <div className="widget-provenance-label">
        Provenance &amp; Collections
        {registry.issues.map((issue) => (
          <IssueBadge key={issue} issue={issue} />
        ))}
      </div>

      {presentation.facets.length > 0 && (
        <div className="widget-provenance-facets">
          {presentation.facets.map((facet) => (
            <div
              key={`${facet.label}-${facet.value}`}
              className={`widget-provenance-facet tone-${facet.tone}`}
              title={facet.detail}
            >
              <span className="widget-provenance-facet-label">{facet.label}</span>
              <span className="widget-provenance-facet-value">{facet.value}</span>
              {facet.detail && (
                <span className="widget-provenance-facet-detail">{facet.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {(protocol.parents?.items.length ?? 0) > 0 && (
        <RelationList
          title="Parent Sample"
          items={protocol.parents?.items ?? []}
          partial={protocol.parents?.partial ?? false}
        />
      )}

      {(protocol.children?.items.length ?? 0) > 0 && (
        <RelationList
          title="Child Sample"
          items={protocol.children?.items ?? []}
          partial={protocol.children?.partial ?? false}
        />
      )}

      {(protocol.gallery?.items.length ?? 0) > 0 && (
        <RelationList
          title="Gallery Sample"
          items={protocol.gallery?.items ?? []}
          partial={protocol.gallery?.partial ?? false}
        />
      )}
    </div>
  )
}

function RelationList({
  title,
  items,
  partial,
}: {
  title: string
  items: RelatedInscriptionSummary[]
  partial: boolean
}) {
  return (
    <div className="widget-provenance-list">
      <div className="widget-provenance-list-title">
        {title}
        {partial && <span className="widget-provenance-partial">sampled</span>}
      </div>
      <div className="widget-provenance-list-items">
        {items.slice(0, 4).map((item) => (
          <a
            key={item.inscription_id}
            className="widget-provenance-item"
            href={`https://ordinals.com/inscription/${item.inscription_id}`}
            target="_blank"
            rel="noreferrer"
          >
            <span>{item.inscription_number != null ? `#${item.inscription_number}` : "unknown"}</span>
            <span>{item.content_type ?? "unknown type"}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
