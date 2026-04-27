import { useState, useRef, useEffect } from "react"

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
  const [isOverflowing, setIsOverflowing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleBadgeClick = (sourceName: string) => {
    setExpanded(true)
    setTimeout(() => {
      const el = document.getElementById(`source-detail-${sourceName.replace(/\s+/g, "-")}`)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }, 100)
  }

  // Detect overflow to show ellipsis/mask only when needed
  useEffect(() => {
    const checkOverflow = () => {
      if (scrollRef.current) {
        setIsOverflowing(scrollRef.current.scrollWidth > scrollRef.current.clientWidth)
      }
    }

    checkOverflow()
    window.addEventListener("resize", checkOverflow)
    return () => window.removeEventListener("resize", checkOverflow)
  }, [sources, expanded])

  return (
    <div className={`widget-sources-minimal ${expanded ? "expanded" : ""}`}>
      <div 
        className="widget-sources-header" 
        onClick={() => setExpanded(!expanded)}
      >
        <div className="widget-sources-label-group">
          <div className="widget-sources-label">
            Verified via
          </div>
          {!expanded && (
            <div 
              ref={scrollRef}
              className={`widget-sources-items-inline ${isOverflowing ? "is-overflowing" : ""}`}
            >
              {sources.map((source) => (
                <span 
                  key={source.name} 
                  className="widget-source-inline"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleBadgeClick(source.name)
                  }}
                  title={source.detail}
                >
                  <span className="widget-source-icon">
                    {statusIcon(source.status)}
                  </span>
                  <span className="widget-source-name">{source.name}</span>
                  {source.count !== undefined && source.count > 0 && (
                    <span className="widget-count-badge">
                      {source.count}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="widget-sources-expander">
          {expanded ? "▲" : "▼"}
        </div>
      </div>

      {expanded && (
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
