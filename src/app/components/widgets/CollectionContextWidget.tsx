import type { CollectionContext, RelatedInscriptionSummary } from "../../lib/types"

interface Props {
  collectionContext: CollectionContext
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
      <div className="widget-provenance-label">Provenance & Collections</div>



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

      {registry.issues.length > 0 && (
        <div className="widget-provenance-notes">
          {registry.issues.map((issue) => (
            <span key={issue} className="widget-provenance-note">
              {issue}
            </span>
          ))}
        </div>
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
