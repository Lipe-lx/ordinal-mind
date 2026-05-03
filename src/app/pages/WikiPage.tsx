import { useEffect, useState } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router"
import type { LayoutOutletContext } from "../components/Layout"
import type { ConsolidatedCollection, ConsolidatedField } from "../lib/types"
import { motion } from "motion/react"
import "../styles/features/wiki/wiki.css"

export function WikiPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()
  
  const [data, setData] = useState<ConsolidatedCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prevSlug, setPrevSlug] = useState(slug)

  if (slug !== prevSlug) {
    setPrevSlug(slug)
    setData(null)
    setError(null)
  }

  useEffect(() => {
    if (!slug) return
    
    // Setup header
    setHeaderCenter(
      <div className="wiki-header-title">
        <h1>Wiki: <span style={{ color: "var(--accent-primary)" }}>{slug}</span></h1>
      </div>
    )

    let ignore = false

    fetch(`/api/wiki/collection/${slug}/consolidated`)
      .then(res => res.json())
      .then(json => {
        if (ignore) return
        if (!json.ok) throw new Error(json.error || "Failed to load wiki")
        setData(json.data)
      })
      .catch(err => {
        if (ignore) return
        console.error(err)
        setError("Could not load collection wiki.")
      })

    return () => {
      ignore = true
      setHeaderCenter(null)
    }
  }, [slug, setHeaderCenter])

  const isLoading = !data && !error

  if (isLoading) {
    return (
      <div className="wiki-page-container fade-in">
        <div className="wiki-loading">
          <motion.div 
            animate={{ rotate: 360, scale: [1, 1.1, 1] }}
            transition={{ rotate: { repeat: Infinity, duration: 2, ease: "linear" }, scale: { repeat: Infinity, duration: 2, ease: "easeInOut" } }}
            style={{ fontSize: "2rem" }}
          >
            ⏳
          </motion.div>
          <p>Compiling community consensus...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="wiki-page-container fade-in">
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center", marginTop: "2rem" }}>
          <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>{error}</p>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="wiki-page-container fade-in">
      <div className="wiki-dashboard">
        {/* Header Stats */}
        <div className="wiki-stats-card glass-card">
          <div className="wiki-stat-item">
            <span className="wiki-stat-label">Completeness</span>
            <span className="wiki-stat-value">{Math.round(data.completeness.score * 100)}%</span>
            <span className="wiki-stat-subtext">{data.completeness.filled} of {data.completeness.total} fields</span>
          </div>
          <div className="wiki-stat-item">
            <span className="wiki-stat-label">Consensus Confidence</span>
            <span className="wiki-stat-value">{Math.round(data.confidence * 100)}%</span>
            <span className="wiki-stat-subtext">Weighted by OG Tiers</span>
          </div>
          <div className="wiki-stat-item">
            <span className="wiki-stat-label">Sources</span>
            <span className="wiki-stat-value">{data.sources.length}</span>
            <span className="wiki-stat-subtext">Community Contributions</span>
          </div>
        </div>

        {/* Factual (L0) Stats */}
        {data.factual && (
          <div className="wiki-stats-card glass-card" style={{ marginTop: "1rem", borderColor: "var(--accent-secondary)", opacity: 0.9 }}>
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">Total Supply</span>
              <span className="wiki-stat-value">{data.factual.supply ? data.factual.supply.toLocaleString() : "Unknown"}</span>
              <span className="wiki-stat-subtext">L0 Inscriptions</span>
            </div>
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">First Discovered</span>
              <span className="wiki-stat-value" style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>
                {data.factual.first_seen ? new Date(data.factual.first_seen).toLocaleDateString() : "Unknown"}
              </span>
              <span className="wiki-stat-subtext">Genesis event</span>
            </div>
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">Last Mint</span>
              <span className="wiki-stat-value" style={{ fontSize: "1.2rem", marginTop: "0.5rem" }}>
                {data.factual.last_seen ? new Date(data.factual.last_seen).toLocaleDateString() : "Unknown"}
              </span>
              <span className="wiki-stat-subtext">Latest genesis</span>
            </div>
          </div>
        )}

        <div className="wiki-grid" style={{ marginTop: "2rem" }}>
          {/* Canonical Fields */}
          <div className="wiki-section glass-card">
            <h2 className="wiki-section-title">Verified Narrative</h2>
            <div className="wiki-fields-list">
              {Object.values(data.narrative).filter(f => f.status === "canonical").length === 0 && (
                <p className="wiki-empty-text">No canonical data verified yet.</p>
              )}
              {Object.values(data.narrative).filter(f => f.status === "canonical").map(field => (
                <WikiFieldItem key={field.field} field={field} />
              ))}
            </div>
          </div>

          <div className="wiki-side-column">
            {/* Disputed Fields */}
            {Object.values(data.narrative).filter(f => f.status === "disputed").length > 0 && (
              <div className="wiki-section glass-card" style={{ borderColor: "var(--warning)" }}>
                <h2 className="wiki-section-title" style={{ color: "var(--warning)" }}>Disputed Knowledge</h2>
                <div className="wiki-fields-list">
                  {Object.values(data.narrative).filter(f => f.status === "disputed").map(field => (
                    <WikiFieldItem key={field.field} field={field} />
                  ))}
                </div>
              </div>
            )}

            {/* Draft Fields */}
            {Object.values(data.narrative).filter(f => f.status === "draft").length > 0 && (
              <div className="wiki-section glass-card" style={{ opacity: 0.8 }}>
                <h2 className="wiki-section-title">Drafts (Awaiting OG)</h2>
                <div className="wiki-fields-list">
                  {Object.values(data.narrative).filter(f => f.status === "draft").map(field => (
                    <WikiFieldItem key={field.field} field={field} />
                  ))}
                </div>
              </div>
            )}

            {/* Gaps */}
            {data.gaps.length > 0 && (
              <div className="wiki-section glass-card">
                <h2 className="wiki-section-title">Missing Context</h2>
                <div className="wiki-gaps-list">
                  {data.gaps.map(gap => (
                    <div key={gap} className="wiki-gap-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="wiki-gap-name">{formatFieldName(gap)}</span>
                      <button 
                        className="btn btn-ghost" 
                        style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                        onClick={() => {
                          if (data.sample_inscription_id) {
                            navigate(`/?id=${data.sample_inscription_id}&builderMode=true&gap=${gap}`)
                          } else {
                            alert("Cannot open builder: No reference inscription found for this collection.")
                          }
                        }}
                      >
                        Contribute +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WikiFieldItem({ field }: { field: ConsolidatedField }) {
  return (
    <div className="wiki-field-item">
      <div className="wiki-field-header">
        <span className="wiki-field-name">{formatFieldName(field.field)}</span>
        <div className="wiki-field-badges">
          {field.status === "disputed" && <span className="wiki-badge warning">Disputed</span>}
          {field.status === "canonical" && <span className="wiki-badge success">Canonical</span>}
          <span className={`wiki-tier-badge tier-${field.resolved_by_tier}`}>{field.resolved_by_tier}</span>
        </div>
      </div>
      {field.status === "disputed" ? (
        <div className="wiki-field-dispute">
          {field.contributions.map((c, i) => (
            <div key={i} className="wiki-dispute-option">
              <span className="wiki-dispute-value">"{c.value}"</span>
              <span className={`wiki-tier-badge tier-${c.og_tier}`}>{c.og_tier}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="wiki-field-value">{field.canonical_value}</p>
      )}
    </div>
  )
}

function formatFieldName(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
