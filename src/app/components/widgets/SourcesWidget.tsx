import { useState } from "react"

export interface DataSource {
  name: string
  status: "success" | "partial" | "failed" | "skipped"
  detail: string
  cached?: boolean
  count?: number
  links?: { label: string; url: string }[]
}

interface Props {
  sources: DataSource[]
}

/** Minimalist data source attribution. Reinforces factual-first product thesis. */
export function SourcesWidget({ sources }: Props) {
  const [expanded, setExpanded] = useState(false)
  const handleBadgeClick = (sourceName: string) => {
    setExpanded(true)
    setTimeout(() => {
      const el = document.getElementById(`source-detail-${sourceName.replace(/\s+/g, "-")}`)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, 100)
  }

  return (
    <div className={`widget-sources-minimal ${expanded ? "expanded" : ""}`}>
      <div 
        className="widget-sources-header" 
        onClick={() => setExpanded(!expanded)}
      >
        <div className="widget-sources-label">
          Verified via
        </div>
        <div className="widget-sources-expander">
          {expanded ? "▲" : "▼"}
        </div>
      </div>

      {!expanded ? (
        <div className="widget-sources-items">
          {sources.map((source) => (
            <span 
              key={source.name} 
              className="widget-source-inline"
              onClick={(e) => {
                e.stopPropagation()
                handleBadgeClick(source.name)
              }}
              style={{ cursor: "pointer" }}
            >
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
      ) : (
        <div className="widget-sources-expanded-list">
          {sources.map((source) => (
            <div 
              key={source.name} 
              id={`source-detail-${source.name.replace(/\s+/g, "-")}`}
              className="widget-source-detail-card"
            >
              <div className="widget-source-detail-header">
                <span className="widget-source-icon">{statusIcon(source.status)}</span>
                <span className="widget-source-name">{source.name}</span>
                {source.cached && <span className="widget-source-cached">(cached)</span>}
              </div>
              <div className="widget-source-detail-desc">{source.detail}</div>
              
              {source.links && source.links.length > 0 && (
                <div className="widget-source-links">
                  {source.links.map((link, i) => (
                    <a 
                      key={i} 
                      href={link.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="widget-source-link"
                    >
                      {link.label} <span className="widget-source-link-icon">↗</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function statusIcon(status: DataSource["status"]): string {
  switch (status) {
    case "success": return "✓"
    case "partial": return "⚠️"
    case "failed": return "✗"
    case "skipped": return "⏭️"
    default: return "?"
  }
}
