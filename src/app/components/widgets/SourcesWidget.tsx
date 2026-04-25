

export interface DataSource {
  name: string
  status: "success" | "partial" | "failed" | "skipped"
  detail: string
  cached?: boolean
  count?: number
}

interface Props {
  sources: DataSource[]
}

/** Minimalist data source attribution. Reinforces factual-first product thesis. */
export function SourcesWidget({ sources }: Props) {
  if (!sources || sources.length === 0) return null

  return (
    <div className="widget-sources-minimal">
      <div className="widget-sources-label">
        Verified via
      </div>
      <div className="widget-sources-items">
        {sources.map((source, i) => (
          <span key={source.name} className="widget-source-inline">
            <span className="widget-source-icon" title={source.detail}>
              {statusIcon(source.status)}
            </span>
            <span className="widget-source-name">{source.name}</span>
            {source.count !== undefined && source.count > 0 && (
              <span className="widget-count-badge" style={{ marginLeft: "2px", padding: "1px 4px" }}>
                {source.count}
              </span>
            )}
            {source.cached && (
              <span className="widget-source-cached" title="Served from cache">
                (cached)
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function statusIcon(status: DataSource["status"]): string {
  switch (status) {
    case "success": return "✓"
    case "partial": return "⚠️"
    case "failed": return "✗"
    case "skipped": return "⏭️"
  }
}
