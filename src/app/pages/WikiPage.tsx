import { useEffect, useState, useCallback } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router"
import type { LayoutOutletContext } from "../components/Layout"
import type { ConsolidatedCollection, ConsolidatedField } from "../lib/types"
import { motion } from "motion/react"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"
import { submitWikiContribution } from "../lib/byok/wikiSubmit"
import type { CanonicalField } from "../lib/byok/wikiCompleteness"
import "../styles/features/wiki/wiki.css"

export function WikiPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>()
  const slug = rawSlug?.startsWith("collection:") ? rawSlug.slice("collection:".length) : rawSlug
  const navigate = useNavigate()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()
  const { identity } = useDiscordIdentity()
  
  const [data, setData] = useState<ConsolidatedCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prevSlug, setPrevSlug] = useState(slug)
  const [deletingField, setDeletingField] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"drafts" | "gaps">("drafts")

  if (slug !== prevSlug) {
    setPrevSlug(slug)
    setData(null)
    setError(null)
  }

  const handleEditCollectionName = useCallback(async (newName: string) => {
    if (!slug) return
    try {
      const result = await submitWikiContribution({
        data: {
          collection_slug: slug,
          field: "name",
          value: newName,
          operation: "add",
          confidence: "correcting_existing",
          verifiable: true,
        },
        activeThreadId: "system-genesis-edit",
        prompt: "Manual rename by Genesis role",
      })

      if (result.ok) {
        // Refresh data
        const res = await fetch(`/api/wiki/collection/${slug}/consolidated`)
        const json = await res.json()
        if (json.ok) {
          setData(json.data)
        }
      } else {
        alert(`Failed to update name: ${result.error}`)
      }
    } catch (err) {
      console.error(err)
      alert("An unexpected error occurred while updating.")
    }
  }, [slug])

  useEffect(() => {
    if (!slug) return
    
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
    }
  }, [slug])

  useEffect(() => {
    const isGenesis = identity?.tier === "genesis"
    
    setHeaderCenter(
      <div className="wiki-header-title" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-sm)" }}>
        <h1>Wiki: <span style={{ color: "var(--accent-primary)" }}>{slug}</span></h1>
        {isGenesis && (
          <button 
            className="wiki-slug-edit-btn"
            title="Edit collection display name"
            onClick={() => {
              const currentName = data?.narrative["name"]?.canonical_value || slug
              const newName = prompt("Enter new display name for this collection:", currentName)
              if (newName !== null && newName !== currentName) {
                handleEditCollectionName(newName)
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
          </button>
        )}
      </div>
    )

    return () => setHeaderCenter(null)
  }, [slug, identity, data, setHeaderCenter, handleEditCollectionName])

  const handleDeleteField = async (fieldKey: string) => {
    if (!slug || !data) return
    if (!confirm(`Are you sure you want to remove all information for "${fieldKey}"? This will mark all published contributions for this field as deleted.`)) {
      return
    }

    setDeletingField(fieldKey)
    try {
      const result = await submitWikiContribution({
        data: {
          collection_slug: slug,
          field: fieldKey as CanonicalField,
          value: "",
          operation: "delete",
          confidence: "correcting_existing",
          verifiable: true,
        },
        activeThreadId: "system-genesis-removal",
        prompt: "Manual removal by Genesis role",
      })

      if (result.ok) {
        // Refresh data
        const res = await fetch(`/api/wiki/collection/${slug}/consolidated`)
        const json = await res.json()
        if (json.ok) {
          setData(json.data)
        }
      } else {
        alert(`Failed to delete field: ${result.error}`)
      }
    } catch (err) {
      console.error(err)
      alert("An unexpected error occurred while deleting.")
    } finally {
      setDeletingField(null)
    }
  }


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
        {/* Top Row: Core Stats + Factual Context */}
        <div className="wiki-top-row">
          <div className="wiki-stats-card">
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">Completeness</span>
              <span className="wiki-stat-value">{Math.round(data.completeness.score * 100)}%</span>
              <span className="wiki-stat-subtext">{data.completeness.filled} / {data.completeness.total} fields</span>
            </div>
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">Consensus</span>
              <span className="wiki-stat-value">{Math.round(data.confidence * 100)}%</span>
              <span className="wiki-stat-subtext">Community weighted</span>
            </div>
            <div className="wiki-stat-item">
              <span className="wiki-stat-label">Sources</span>
              <span className="wiki-stat-value">{data.sources.length}</span>
              <span className="wiki-stat-subtext">Active sources</span>
            </div>
          </div>

          {data.factual && (
            <div className="wiki-stats-card" style={{ background: "linear-gradient(135deg, rgba(247, 147, 26, 0.05), rgba(255, 255, 255, 0.01))" }}>
              <div className="wiki-stat-item">
                <span className="wiki-stat-label">Supply</span>
                <span className="wiki-stat-value" style={{ fontSize: "1.75rem" }}>{data.factual.supply ? data.factual.supply.toLocaleString() : "—"}</span>
                <span className="wiki-stat-subtext">Inscriptions</span>
              </div>
              <div className="wiki-stat-item">
                <span className="wiki-stat-label">Genesis</span>
                <span className="wiki-stat-value" style={{ fontSize: "1.25rem", marginTop: "0.25rem" }}>
                  {data.factual.first_seen ? new Date(data.factual.first_seen).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                </span>
                <span className="wiki-stat-subtext">Discovery</span>
              </div>
              <div className="wiki-stat-item">
                <span className="wiki-stat-label">Last Activity</span>
                <span className="wiki-stat-value" style={{ fontSize: "1.25rem", marginTop: "0.25rem" }}>
                  {data.factual.last_seen ? new Date(data.factual.last_seen).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                </span>
                <span className="wiki-stat-subtext">Latest sync</span>
              </div>
            </div>
          )}
        </div>

        <div className="wiki-grid">
          {/* Main Content Area: Narratives & Knowledge */}
          <div className="wiki-main-content">
            {/* Canonical Fields */}
            <div className="wiki-section">
              <h2 className="wiki-section-title" style={{ marginBottom: "var(--space-md)" }}>Verified Narrative</h2>
              <div className="wiki-two-column-grid">
                {Object.values(data.narrative).filter(f => f.status === "canonical").length === 0 && (
                  <p className="wiki-empty-text" style={{ gridColumn: "1 / -1" }}>Searching for established consensus…</p>
                )}
                {Object.values(data.narrative).filter(f => f.status === "canonical").map(field => (
                  <WikiFieldItem 
                    key={field.field} 
                    field={field} 
                    showDelete={identity?.tier === "genesis"}
                    isDeleting={deletingField === field.field}
                    onDelete={() => handleDeleteField(field.field)}
                  />
                ))}
              </div>
            </div>

            {/* Disputed Fields (Special Case) */}
            {Object.values(data.narrative).filter(f => f.status === "disputed").length > 0 && (
              <div className="wiki-section" style={{ borderColor: "rgba(251, 191, 36, 0.3)" }}>
                <h2 className="wiki-section-title" style={{ color: "var(--rarity-legendary)", marginBottom: "var(--space-md)" }}>Disputed Knowledge</h2>
                <div className="wiki-two-column-grid">
                  {Object.values(data.narrative).filter(f => f.status === "disputed").map(field => (
                    <WikiFieldItem 
                      key={field.field} 
                      field={field} 
                      showDelete={identity?.tier === "genesis"}
                      isDeleting={deletingField === field.field}
                      onDelete={() => handleDeleteField(field.field)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar: Actionable Intel & Gaps */}
          <aside className="wiki-sidebar">
            <div className="wiki-section" style={{ borderLeft: "2px solid rgba(247, 147, 26, 0.3)", background: "rgba(247, 147, 26, 0.02)" }}>
              <header className="wiki-section-header">
                <h2 className="wiki-section-title" style={{ fontSize: "0.85rem" }}>
                  {activeTab === "drafts" ? "Draft Proposals" : "Missing Data"}
                </h2>
                <div className="wiki-toggle-group">
                  <button 
                    className={`wiki-toggle-btn ${activeTab === "drafts" ? "active" : ""}`}
                    onClick={() => setActiveTab("drafts")}
                  >
                    Drafts
                  </button>
                  <button 
                    className={`wiki-toggle-btn ${activeTab === "gaps" ? "active" : ""}`}
                    onClick={() => setActiveTab("gaps")}
                  >
                    Gaps
                  </button>
                </div>
              </header>

              <div className="wiki-fields-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                {activeTab === "drafts" ? (
                  <>
                    {Object.values(data.narrative).filter(f => f.status === "draft").length === 0 ? (
                      <p className="wiki-empty-text">No pending drafts.</p>
                    ) : (
                      Object.values(data.narrative).filter(f => f.status === "draft").map(field => (
                        <WikiFieldItem 
                          key={field.field} 
                          field={field} 
                          showDelete={identity?.tier === "genesis"}
                          isDeleting={deletingField === field.field}
                          onDelete={() => handleDeleteField(field.field)}
                        />
                      ))
                    )}
                  </>
                ) : (
                  <>
                    {data.gaps.length === 0 ? (
                      <p className="wiki-empty-text">All canonical fields filled.</p>
                    ) : (
                      data.gaps.map(gap => (
                        <div key={gap} className="wiki-gap-item" style={{ padding: "var(--space-md)" }}>
                          <span className="wiki-gap-name" style={{ fontSize: "0.75rem" }}>{formatFieldName(gap)}</span>
                          <button 
                            className="btn btn-ghost btn-xs" 
                            style={{ padding: "2px 8px", fontSize: "0.65rem", color: "var(--accent-primary)" }}
                            onClick={() => {
                              if (data.sample_inscription_id) {
                                navigate(`/?id=${data.sample_inscription_id}&builderMode=true&gap=${gap}`)
                              } else {
                                alert("Cannot open builder: No reference found.")
                              }
                            }}
                          >
                            CONTRIBUTE
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function WikiFieldItem({ 
  field, 
  showDelete, 
  isDeleting, 
  onDelete 
}: { 
  field: ConsolidatedField, 
  showDelete?: boolean,
  isDeleting?: boolean,
  onDelete?: () => void
}) {
  return (
    <div className="wiki-field-item">
      <div className="wiki-field-header">
        <span className="wiki-field-name">{formatFieldName(field.field)}</span>
        <div className="wiki-field-badges">
          {field.status === "disputed" && <span className="wiki-badge warning">Disputed</span>}
          {field.status === "canonical" && <span className="wiki-badge success">Canonical</span>}
          <span className={`wiki-tier-badge tier-${field.resolved_by_tier}`}>{field.resolved_by_tier}</span>
          
          {showDelete && (
            <button 
              className="wiki-field-delete-btn"
              onClick={onDelete}
              disabled={isDeleting}
              title="Remove this field's information"
            >
              {isDeleting ? (
                <span className="loading-spinner-tiny" style={{ width: "12px", height: "12px", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "var(--danger)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              )}
            </button>
          )}
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
