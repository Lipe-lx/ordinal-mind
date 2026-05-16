import { useEffect, useState, useCallback } from "react"
import { useParams, useNavigate, useLocation, useOutletContext } from "react-router"
import type { LayoutOutletContext } from "../components/Layout"
import type { ConsolidatedCollection, ConsolidatedField, PublicAuthor } from "../lib/types"
import { motion } from "motion/react"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"
import { submitWikiContribution } from "../lib/byok/wikiSubmit"
import type { CanonicalField } from "../lib/byok/wikiCompleteness"
import { WikiContributionModal, buildWikiContributionSessionId, resolveContributionStatusMessage } from "../components/WikiContributionModal"
import { WikiPublicAuthorAvatar } from "../components/WikiPublicAuthorAvatar"
import "../styles/features/wiki/wiki.css"

export function WikiPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>()
  const slug = rawSlug?.startsWith("collection:") ? rawSlug.slice("collection:".length) : rawSlug
  const navigate = useNavigate()
  const location = useLocation()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()
  const { identity, connect } = useDiscordIdentity()
  
  const [data, setData] = useState<ConsolidatedCollection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prevSlug, setPrevSlug] = useState(slug)
  const [deletingField, setDeletingField] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"drafts" | "gaps">("drafts")
  const [contributePromptGap, setContributePromptGap] = useState<string | null>(null)
  const [contributionModalGap, setContributionModalGap] = useState<CanonicalField | null>(null)

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

  const refreshWikiData = useCallback(async () => {
    if (!slug) return false

    try {
      const res = await fetch(`/api/wiki/collection/${slug}/consolidated`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || "Failed to load wiki")
      setData(json.data)
      setError(null)
      return true
    } catch (err) {
      console.error(err)
      setError("Could not load collection wiki.")
      return false
    }
  }, [slug])

  useEffect(() => {
    if (!slug) return
    
    let ignore = false

    void (async () => {
      try {
        const res = await fetch(`/api/wiki/collection/${slug}/consolidated`)
        const json = await res.json()
        if (ignore) return
        if (!json.ok) throw new Error(json.error || "Failed to load wiki")
        setData(json.data)
      } catch (err) {
        if (ignore) return
        console.error(err)
        setError("Could not load collection wiki.")
      }
    })()

    return () => {
      ignore = true
    }
  }, [slug])

  const handleGapContribution = useCallback((gap: string) => {
    if (!identity) {
      setContributePromptGap(gap)
      return
    }

    setContributePromptGap(null)
    setContributionModalGap(gap as CanonicalField)
  }, [identity])

  const closeContributionModal = useCallback(() => {
    setContributionModalGap(null)
  }, [])

  const handleSubmitContribution = useCallback(async (nextValue: string, publicAuthorMode: "anonymous" | "public") => {
    if (!slug || !contributionModalGap) {
      return { ok: false, message: "No contribution target selected." }
    }

    try {
      const result = await submitWikiContribution({
        data: {
          collection_slug: slug,
          field: contributionModalGap,
          value: nextValue,
          operation: "add",
          confidence: "stated_by_user",
          verifiable: false,
          public_author_mode: publicAuthorMode,
        },
        activeThreadId: buildWikiContributionSessionId(slug, contributionModalGap),
        prompt: nextValue,
      })

      if (!result.ok) {
        const message = result.http_status === 401 || result.http_status === 403
          ? "Your session expired. Connect Discord again to keep contributing."
          : "We could not record this contribution right now."
        return { ok: false, message }
      }

      await refreshWikiData()
      setActiveTab("drafts")
      return { ok: true, message: resolveContributionStatusMessage(result.status) }
    } catch {
      return { ok: false, message: "We could not record this contribution right now." }
    }
  }, [slug, contributionModalGap, refreshWikiData])

  useEffect(() => {
    const isGenesis = identity?.tier === "genesis"
    
    setHeaderCenter(
      <div className="wiki-header-title" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-md)" }}>
        <button 
          onClick={() => {
            const searchParams = new URLSearchParams(location.search)
            const fromId = searchParams.get("from")
            
            if (fromId) {
              searchParams.delete("from")
              const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ""
              navigate(`/chronicle/${fromId}${suffix}`)
            } else if (data?.sample_inscription_id) {
              navigate(`/chronicle/${data.sample_inscription_id}${location.search}`)
            } else {
              navigate(-1)
            }
          }} 
          className="btn btn-ghost btn-xs"
          style={{ padding: "4px 8px", fontSize: "0.75rem" }}
        >
          ← Back
        </button>
        <div style={{ width: "1px", height: "16px", background: "var(--border-glass)", margin: "0 4px" }} />
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
  }, [slug, identity, data, setHeaderCenter, handleEditCollectionName, navigate, location])

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
              <header className="wiki-section-header" style={{ padding: "var(--space-xl) var(--space-xl) var(--space-md) var(--space-xl)", borderBottom: "none" }}>
                <h2 className="wiki-section-title">Verified Narrative</h2>
              </header>
              <div className="wiki-section-content">
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
            </div>

            {/* Disputed Fields (Special Case) */}
            {Object.values(data.narrative).filter(f => f.status === "disputed").length > 0 && (
              <div className="wiki-section" style={{ borderColor: "rgba(251, 191, 36, 0.3)" }}>
                <header className="wiki-section-header" style={{ padding: "var(--space-xl) var(--space-xl) var(--space-md) var(--space-xl)", borderBottom: "none" }}>
                  <h2 className="wiki-section-title" style={{ color: "var(--rarity-legendary)" }}>Disputed Knowledge</h2>
                </header>
                <div className="wiki-section-content">
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
              </div>
            )}
          </div>

          {/* Right Sidebar: Actionable Intel & Gaps */}
          <aside className="wiki-sidebar">
            <div className="wiki-section wiki-sidebar-section">
              <header className="wiki-section-header" style={{ padding: "var(--space-lg) var(--space-xl) var(--space-md) var(--space-xl)" }}>
                <h2 className="wiki-section-title" style={{ fontSize: "0.85rem" }}>
                  {activeTab === "drafts" ? "Draft Contributions" : "Missing Data"}
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

              <div className="wiki-section-content" style={{ padding: "var(--space-md) var(--space-xl) var(--space-xl) var(--space-xl)" }}>
                {activeTab === "gaps" && contributePromptGap && !identity && (
                  <div className="wiki-gap-item" style={{ marginBottom: "var(--space-md)", padding: "var(--space-md)", borderColor: "rgba(88, 101, 242, 0.35)" }}>
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      <span className="wiki-gap-name" style={{ fontSize: "0.78rem" }}>Connect Discord to contribute</span>
                      <p className="wiki-empty-text" style={{ margin: 0, textAlign: "left" }}>
                        Sign in to contribute to <strong>{formatFieldName(contributePromptGap)}</strong>. Logged-in collectors can publish draft knowledge without blocking the factual Chronicle.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ justifySelf: "flex-start" }}
                        onClick={connect}
                      >
                        Connect Discord
                      </button>
                    </div>
                  </div>
                )}

                <div className="wiki-fields-list" style={{ gap: "var(--space-md)" }}>
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
                              onClick={() => handleGapContribution(gap)}
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
            </div>
          </aside>
        </div>
      </div>
      <WikiContributionModal
        open={Boolean(contributionModalGap)}
        slug={slug ?? ""}
        field={contributionModalGap}
        identityTier={identity?.tier}
        identityPreview={identity ? { username: identity.username, avatar: identity.avatar } : null}
        onClose={closeContributionModal}
        onSubmit={handleSubmitContribution}
      />
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
  const visibleAuthor = resolveVisiblePublicAuthor(field)

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
              {c.public_author && (
                <WikiPublicAuthorAvatar author={c.public_author} size="xs" label="Visible author" />
              )}
              <span className="wiki-dispute-value">"{c.value}"</span>
              <span className={`wiki-tier-badge tier-${c.og_tier}`}>{c.og_tier}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="wiki-field-value-row">
          {visibleAuthor && (
            <WikiPublicAuthorAvatar author={visibleAuthor} size="xs" label="Visible author" />
          )}
          <p className="wiki-field-value">{field.canonical_value}</p>
        </div>
      )}
    </div>
  )
}

function resolveVisiblePublicAuthor(field: ConsolidatedField): PublicAuthor | null {
  if (field.status === "disputed") return null
  return field.contributions[0]?.public_author ?? null
}

function formatFieldName(name: string): string {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
