import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router"
import cytoscape from "cytoscape"
import cytoscapeElk from "cytoscape-elk"
import cytoscapeFcose from "cytoscape-fcose"
import cytoscapeCola from "cytoscape-cola"
import { useDeterministicRendering } from "../lib/useDeterministicRendering"
import { useMediaQuery } from "../lib/useMediaQuery"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"
import { submitWikiContribution } from "../lib/byok/wikiSubmit"
import type { CanonicalField } from "../lib/byok/wikiCompleteness"
import type { WikiGraphNode } from "../lib/types"
import {
  buildNodeInspector,
  createDefaultWikiGraphFilters,
  fetchWikiGraph,
  filterWikiGraphPayload,
  formatKindLabel,
  formatStatusLabel,
  toCytoscapeElements,
  WIKI_GRAPH_NODE_KINDS,
  WIKI_GRAPH_STATUSES,
  type WikiGraphFilters,
} from "../lib/wikiGraph"
import "../styles/features/wiki/wiki-graph.css"

cytoscape.use(cytoscapeElk)
cytoscape.use(cytoscapeFcose)
cytoscape.use(cytoscapeCola)

interface ColaLayoutOptions extends cytoscape.ShapedLayoutOptions {
  name: "cola"
  refresh?: number
  maxSimulationTime?: number
  ungrabifyWhileSimulating?: boolean
  nodeSpacing?: (node: cytoscape.NodeSingular) => number
  edgeLength?: number | ((edge: cytoscape.EdgeSingular) => number)
  infinite?: boolean
  avoidOverlap?: boolean
  alphaTest?: number
  initialUnconstrainedIterations?: number
  initialUserConstraintIterations?: number
  initialAllConstraintsIterations?: number
}

interface Props {
  open: boolean
  collectionSlug?: string
  focusSlug?: string | null
  wikiStatusLabel?: string
  onClose: () => void
}


export function WikiGraphModal({
  open,
  collectionSlug,
  focusSlug,
  wikiStatusLabel,
  onClose,
}: Props) {
  const navigate = useNavigate()
  const isMobile = useMediaQuery("(max-width: 899px)")
  const deterministicRendering = useDeterministicRendering()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<WikiGraphFilters>(createDefaultWikiGraphFilters)
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchWikiGraph>>>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [mobileInspectorExpanded, setMobileInspectorExpanded] = useState(false)
  const deferredSearch = useDeferredValue(filters.search)
  const [prevIsMobile, setPrevIsMobile] = useState(isMobile)
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile)
    if (!isMobile) {
      setMobileControlsOpen(false)
      setMobileInspectorExpanded(false)
    }
  }
  const [deletingContributionId, setDeletingContributionId] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(open)

  // Sync state when modal opens
  if (open && !prevOpen) {
    setPrevOpen(true)
    setFilters(createModalFilters(isMobile, deterministicRendering))
    setPayload(null)
    setSelectedNodeId(null)
    setMobileControlsOpen(false)
    setMobileInspectorExpanded(false)
    if (!collectionSlug) {
      setError("No collection wiki context is available for this inscription yet.")
      setLoading(false)
    } else {
      setError(null)
      setLoading(true)
    }
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== "Tab") return
      const root = dialogRef.current
      if (!root) return

      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    closeButtonRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !collectionSlug) return

    let cancelled = false

    void fetchWikiGraph(collectionSlug, { focus: focusSlug }).then((result) => {
      if (cancelled) return
      setPayload(result)
      setError(result ? null : "Could not load the collection wiki graph.")
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, collectionSlug, focusSlug])

  const filteredPayload = useMemo(() => {
    if (!payload) return null
    return filterWikiGraphPayload(payload, {
      ...filters,
      search: deferredSearch,
    })
  }, [payload, filters, deferredSearch])
  
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !filteredPayload) return null
    return filteredPayload.nodes.find(n => n.id === selectedNodeId) ?? null
  }, [selectedNodeId, filteredPayload])

  const inspectorData = useMemo(() => {
    if (!selectedNode) return null
    return buildNodeInspector(selectedNode)
  }, [selectedNode])

  // Mobile inspector state is managed by Cytoscape events (select/unselect/tap)

  const handleFitGraph = () => {
    cyRef.current?.fit(undefined, isMobile ? 64 : 80)
  }

  const handleRecenterFocus = () => {
    const nodeId = filteredPayload?.focus_node_id
    if (!nodeId || !cyRef.current) return
    const network = collectFullNetwork(cyRef.current, nodeId)
    if (network.empty()) return
    if (deterministicRendering) {
      cyRef.current.fit(network, 90)
    } else {
      cyRef.current.animate({
        fit: { eles: network, padding: 90 },
        duration: 260,
      })
    }
  }
  
  const { identity } = useDiscordIdentity()

  const handleDeleteContribution = async (node: WikiGraphNode) => {
    if (!collectionSlug || !node.metadata.contribution_id) return
    
    const contribId = node.metadata.contribution_id as string
    const field = node.metadata.field as CanonicalField

    if (!confirm(`Are you sure you want to delete this specific contribution?`)) {
      return
    }

    setDeletingContributionId(contribId)
    try {
      const result = await submitWikiContribution({
        data: {
          collection_slug: collectionSlug,
          field: field,
          value: "",
          id: contribId,
          operation: "delete",
          confidence: "correcting_existing",
          verifiable: true,
        },
        activeThreadId: "system-genesis-graph-removal",
        prompt: "Manual contribution removal from Graph Atlas by Genesis role",
      })

      if (result.ok) {
        // Refresh graph data
        const freshPayload = await fetchWikiGraph(collectionSlug, { focus: focusSlug })
        if (freshPayload) {
          setPayload(freshPayload)
          setSelectedNodeId(null) // Close inspector as node is gone
        }
      } else {
        alert(`Failed to delete contribution: ${result.error}`)
      }
    } catch (err) {
      console.error(err)
      alert("An unexpected error occurred while deleting.")
    } finally {
      setDeletingContributionId(null)
    }
  }

  const handleResetLayout = () => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().unlock()
    cy.layout(buildGraphLayout(filters.viewMode, {
      randomize: !deterministicRendering,
      deterministic: deterministicRendering,
    })).run()
  }

  const handleInspectorClose = () => {
    if (selectedNodeId) {
      cyRef.current?.getElementById(selectedNodeId).unselect()
    }
    setSelectedNodeId(null)
    setMobileInspectorExpanded(false)
  }

  const renderToolButtons = (buttonClassName: string, iconSize: number) => (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={handleFitGraph}
        title="Fit view to all nodes"
      >
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        <span>Fit</span>
      </button>
      <button
        type="button"
        className={buttonClassName}
        title="Recenter on focus node"
        onClick={handleRecenterFocus}
      >
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} stroke="currentColor" strokeWidth="2" fill="none">
          <circle cx="12" cy="12" r="3" />
          <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
        </svg>
        <span>Recenter</span>
      </button>
      <button
        type="button"
        className={buttonClassName}
        title="Reset layout and unlock pins"
        onClick={handleResetLayout}
      >
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        <span>Reset</span>
      </button>
    </>
  )

  const viewToggle = (
    <div className="wiki-graph-view-toggle">
      <button
        type="button"
        className={`view-toggle-item ${filters.viewMode === "neural" ? "is-active" : ""}`}
        onClick={() => setFilters((current) => ({ ...current, viewMode: "neural" }))}
      >
        Neural
      </button>
      <button
        type="button"
        className={`view-toggle-item ${filters.viewMode === "tree" ? "is-active" : ""}`}
        onClick={() => setFilters((current) => ({ ...current, viewMode: "tree" }))}
      >
        Tree
      </button>
      <div className={`view-toggle-slider mode-${filters.viewMode}`} />
    </div>
  )

  const filterChips = (
    <>
      <div className="wiki-graph-filter-group">
        <div className="wiki-graph-filter-group-heading">Node types</div>
        <div className="wiki-graph-chip-row">
          {WIKI_GRAPH_NODE_KINDS.map((kind) => {
            const active = filters.nodeKinds.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                className={`wiki-graph-chip ${active ? "is-active" : ""}`}
                onClick={() => setFilters((current) => ({
                  ...current,
                  nodeKinds: toggleValue(current.nodeKinds, kind, WIKI_GRAPH_NODE_KINDS),
                }))}
              >
                {formatKindLabel(kind)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="wiki-graph-filter-group">
        <div className="wiki-graph-filter-group-heading">Status</div>
        <div className="wiki-graph-chip-row">
          {WIKI_GRAPH_STATUSES.map((status) => {
            const active = filters.statuses.includes(status)
            return (
              <button
                key={status}
                type="button"
                className={`wiki-graph-chip status-${status} ${active ? "is-active" : ""}`}
                onClick={() => setFilters((current) => ({
                  ...current,
                  statuses: toggleValue(current.statuses, status, WIKI_GRAPH_STATUSES),
                }))}
              >
                {formatStatusLabel(status)}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )


  useEffect(() => {
    const container = containerRef.current
    if (!container || !filteredPayload) return

    const cy = cytoscape({
      container,
      elements: toCytoscapeElements(filteredPayload),
      layout: buildGraphLayout(filters.viewMode, {
        randomize: !deterministicRendering,
        deterministic: deterministicRendering,
      }),
      wheelSensitivity: 0.35,
      minZoom: 0.02,
      maxZoom: 10.0,
      zoomingEnabled: true,
      userZoomingEnabled: true,
      panningEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      style: buildGraphStylesheet(filters.viewMode, deterministicRendering),
    })

    // Tracks the node whose full network is persistently highlighted (click-locked).
    let lockedNodeId: string | null = null

    const clearHover = () => {
      cy.elements().removeClass("is-faded is-highlighted")
    }

    const applyEmphasis = (nodeId: string | null) => {
      clearHover()
      if (!nodeId) return
      const center = cy.getElementById(nodeId)
      if (!center.length) return
      const neighborhood = center.closedNeighborhood()
      cy.elements().difference(neighborhood).addClass("is-faded")
      neighborhood.addClass("is-highlighted")
    }

    cy.on("mouseover", "node", (event) => {
      applyEmphasis(event.target.id())
    })

    cy.on("mouseover", "edge", (event) => {
      clearHover()
      const edge = event.target
      const neighborhood = edge.connectedNodes().union(edge)
      cy.elements().difference(neighborhood).addClass("is-faded")
      neighborhood.addClass("is-highlighted")
    })

    cy.on("mouseout", () => {
      // Restore locked selection highlight, or clear everything
      if (lockedNodeId) {
        applyEmphasis(lockedNodeId)
      } else {
        clearHover()
      }
    })

    cy.on("dbltap", "node", (event) => {
      const node = filteredPayload?.nodes.find((item) => item.id === event.target.id())
      if (!node) return
      const target = resolveNavigationTarget(node)
      if (target) navigate(target)
    })

    cy.on("select", "node", (event) => {
      lockedNodeId = event.target.id()
      applyEmphasis(lockedNodeId)
      setSelectedNodeId(event.target.id())
      if (isMobile) {
        setMobileControlsOpen(false)
        setMobileInspectorExpanded(false)
      }
    })

    cy.on("unselect", "node", () => {
      lockedNodeId = null
      clearHover()
      setSelectedNodeId(null)
      if (isMobile) {
        setMobileInspectorExpanded(false)
      }
    })

    cy.on("tap", (event) => {
      if (event.target === cy) {
        lockedNodeId = null
        cy.elements().unselect()
        clearHover()
        setSelectedNodeId(null)
        if (isMobile) {
          setMobileInspectorExpanded(false)
        }
      }
    })

    if (filters.viewMode === "neural") {
      // mousedown fires before grab — unlocking here ensures locked nodes can be grabbed again
      cy.on("mousedown", "node", (event) => {
        event.target.unlock()
      })

      cy.on("free", "node", (event) => {
        // Pin the node at the dropped position — Cola won't push it away
        event.target.lock()
      })
    }

    cy.on("dbltap", (event) => {
      if (event.target === cy) {
        fitGraph()
      }
    })

    const initialFocus = filteredPayload?.focus_node_id ?? filteredPayload?.nodes[0]?.id ?? null
    if (initialFocus) {
      const focusNode = cy.getElementById(initialFocus)
      if (focusNode.length) {
        focusNode.select()
      }
    }

    const fitGraph = () => {
      const elements = cy.elements()
      if (!elements.length) return

      cy.fit(elements, 72)
    }

    const onLayoutReady = () => {
      fitGraph()
    }

    cy.one("layoutready", onLayoutReady)
    cy.one("layoutstop", fitGraph)

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [deterministicRendering, filteredPayload, filters.viewMode, isMobile, navigate])


  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wiki-graph-overlay"
          initial={deterministicRendering ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={deterministicRendering ? undefined : { opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={dialogRef}
            className={`wiki-graph-modal glass-card ${isMobile ? "is-mobile-sheet" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiki-graph-title"
            initial={deterministicRendering ? false : { opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={deterministicRendering ? undefined : { opacity: 0, scale: 0.96, y: 24 }}
            transition={{ duration: deterministicRendering ? 0 : 0.22 }}
          >
            <header className={`wiki-graph-header premium-header ${isMobile ? "is-mobile-header" : ""}`}>
              {isMobile ? (
                <>
                  <div className="wiki-graph-mobile-topbar">
                    <div className="header-left">
                      <h2 id="wiki-graph-title">Wiki Atlas</h2>
                      {wikiStatusLabel && (
                        <div className="wiki-graph-status-badge">
                          <span className="status-dot" />
                          {wikiStatusLabel}
                        </div>
                      )}
                    </div>

                    <button
                      ref={closeButtonRef}
                      type="button"
                      className="btn-close-minimal"
                      onClick={onClose}
                      aria-label="Close modal"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="header-search-wrap">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" className="search-icon">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      className="header-search-input"
                      value={filters.search}
                      onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                      placeholder="Search entities..."
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="header-left">
                    <h2 id="wiki-graph-title">Wiki Atlas</h2>
                    {wikiStatusLabel && (
                      <div className="wiki-graph-status-badge">
                        <span className="status-dot" />
                        {wikiStatusLabel}
                      </div>
                    )}
                  </div>

                  <div className="header-center">
                    <div className="header-search-wrap">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" className="search-icon">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                      </svg>
                      <input
                        className="header-search-input"
                        value={filters.search}
                        onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                        placeholder="Search entities..."
                      />
                    </div>
                  </div>

                  <div className="header-right">
                    <div className="header-tool-group">
                      {renderToolButtons("tool-btn", 16)}
                    </div>

                    <div className="header-divider" />

                    <button
                      ref={closeButtonRef}
                      type="button"
                      className="btn-close-minimal"
                      onClick={onClose}
                      aria-label="Close modal"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </header>

            {isMobile ? (
              <div className="wiki-graph-mobile-controls">
                <div className="wiki-graph-mobile-controls-bar">
                  {viewToggle}
                  <button
                    type="button"
                    className={`mobile-controls-toggle ${mobileControlsOpen ? "is-open" : ""}`}
                    onClick={() => setMobileControlsOpen((current) => !current)}
                    aria-expanded={mobileControlsOpen}
                    aria-controls="wiki-graph-mobile-controls-panel"
                  >
                    <span>Filters</span>
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {mobileControlsOpen && (
                    <motion.div
                      id="wiki-graph-mobile-controls-panel"
                      className="wiki-graph-mobile-controls-panel"
                      initial={deterministicRendering ? false : { opacity: 0, y: -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={deterministicRendering ? undefined : { opacity: 0, y: -8 }}
                      transition={{ duration: deterministicRendering ? 0 : 0.18 }}
                    >
                      <div className="wiki-graph-mobile-tools">
                        {renderToolButtons("mobile-tool-btn", 14)}
                      </div>
                      <div className="wiki-graph-mobile-filter-sections">
                        {filterChips}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="wiki-graph-toolbar">
                <div className="wiki-graph-toolbar-main">
                  {viewToggle}

                  <div className="wiki-graph-toolbar-filters">
                    {filterChips}
                  </div>
                </div>
              </div>
            )}

            <div className={`wiki-graph-body view-${filters.viewMode} ${isMobile ? "is-mobile" : ""}`}>
              <section className="wiki-graph-canvas-panel">
                {loading && (
                  <div className="wiki-graph-state">
                    <div className="wiki-graph-spinner" />
                    <p>Loading graph…</p>
                  </div>
                )}

                {!loading && error && (
                  <div className="wiki-graph-state is-error">
                    <p>{error}</p>
                  </div>
                )}

                {!loading && !error && filteredPayload && filteredPayload.nodes.length === 0 && (
                  <div className="wiki-graph-state">
                    <p>No nodes match the active filters.</p>
                  </div>
                )}

                {!loading && !error && filteredPayload && filteredPayload.nodes.length > 0 && (
                  <>
                    <div className="wiki-graph-stats">
                      <span>{filteredPayload.counts.nodes} nodes</span>
                      <span>{filteredPayload.counts.edges} edges</span>
                    </div>
                    <div ref={containerRef} className="wiki-graph-canvas" />

                  </>
                )}
              </section>
              
              <AnimatePresence>
                {selectedNode && inspectorData && (
                  <motion.aside
                    className={`wiki-graph-inspector glass-card ${isMobile ? "is-mobile-sheet" : ""} ${isMobile && !mobileInspectorExpanded ? "is-peek" : "is-expanded"}`}
                    initial={deterministicRendering ? false : (isMobile ? { y: "100%", opacity: 0 } : { x: "100%", opacity: 0 })}
                    animate={{ x: 0, y: 0, opacity: 1 }}
                    exit={deterministicRendering ? undefined : (isMobile ? { y: "100%", opacity: 0 } : { x: "100%", opacity: 0 })}
                    transition={deterministicRendering ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 200 }}
                  >
                    <header className="wiki-graph-inspector-header">
                      {isMobile && (
                        <button
                          type="button"
                          className="wiki-graph-inspector-handle"
                          onClick={() => setMobileInspectorExpanded((current) => !current)}
                          aria-label={mobileInspectorExpanded ? "Collapse details" : "Expand details"}
                        >
                          <span />
                        </button>
                      )}
                      <div className="wiki-graph-inspector-top">
                        <div>
                          <h4>{inspectorData.title}</h4>
                          <span className={`wiki-graph-node-pill status-${selectedNode.status}`}>
                            {formatStatusLabel(selectedNode.status)}
                          </span>
                          <p className="wiki-graph-inspector-subtitle">{inspectorData.subtitle}</p>
                        </div>
                        <div className="wiki-graph-inspector-actions">
                          {isMobile && (
                            <button
                              type="button"
                              className="wiki-graph-inspector-toggle"
                              onClick={() => setMobileInspectorExpanded((current) => !current)}
                            >
                              {mobileInspectorExpanded ? "Less" : "More"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={handleInspectorClose}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </header>

                    {(!isMobile || mobileInspectorExpanded) && (
                      <>
                        <div className="wiki-graph-inspector-content">
                          {inspectorData.description && (
                            <p className="wiki-graph-inspector-description">
                              {inspectorData.description}
                            </p>
                          )}

                          {inspectorData.details.length > 0 && (
                            <div className="wiki-graph-inspector-details-group">
                              <label>Metadata</label>
                              <dl className="wiki-graph-inspector-details">
                                {inspectorData.details.map((detail, idx) => (
                                  <div key={idx} className="wiki-graph-inspector-row">
                                    <dt>{detail.label}</dt>
                                    <dd>{detail.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                        </div>

                        <footer className="wiki-graph-inspector-footer">
                          {selectedNode.kind === "claim" && identity?.tier === "genesis" && (
                            <button
                              type="button"
                              className="btn-danger btn-block mb-sm"
                              onClick={() => handleDeleteContribution(selectedNode)}
                              disabled={deletingContributionId === selectedNode.metadata.contribution_id}
                            >
                              {deletingContributionId === selectedNode.metadata.contribution_id ? (
                                <span className="loading-spinner-tiny" style={{ marginRight: "8px" }} />
                              ) : (
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: "8px", verticalAlign: "middle" }}>
                                  <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              )}
                              Delete Contribution
                            </button>
                          )}
                          {resolveNavigationTarget(selectedNode) && (
                            <button
                              type="button"
                              className="btn-premium btn-block"
                              onClick={() => {
                                const target = resolveNavigationTarget(selectedNode)
                                if (target) navigate(target)
                              }}
                            >
                              View Chronicle
                            </button>
                          )}
                        </footer>
                      </>
                    )}
                  </motion.aside>
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (typeof document === "undefined") return null
  return createPortal(content, document.body)
}

function createModalFilters(isMobile: boolean, deterministicRendering = false): WikiGraphFilters {
  return {
    ...createDefaultWikiGraphFilters(),
    viewMode: isMobile || deterministicRendering ? "tree" : "neural",
  }
}

function toggleValue<T>(current: T[], value: T, fallback: T[]): T[] {
  const uniqueCurrent = Array.from(new Set(current))
  const active = uniqueCurrent.includes(value)
  if (active) {
    const next = uniqueCurrent.filter((item) => item !== value)
    return next.length > 0 ? next : [...fallback]
  }
  return [...uniqueCurrent, value]
}

function resolveNavigationTarget(node: WikiGraphNode): string | null {
  if (node.href) return node.href

  const inscriptionId = typeof node.metadata.inscription_id === "string"
    ? node.metadata.inscription_id
    : typeof node.metadata.sample_inscription_id === "string"
      ? node.metadata.sample_inscription_id
      : null

  if (inscriptionId) {
    return `/chronicle/${encodeURIComponent(inscriptionId)}`
  }

  return null
}


/**
 * BFS from rootId, collecting every transitively reachable node and edge.
 * Returns the full connected subgraph as a Cytoscape collection.
 */
function collectFullNetwork(cy: cytoscape.Core, rootId: string): cytoscape.Collection {
  const root = cy.getElementById(rootId)
  if (!root.length) return cy.collection()

  const visited = new Set<string>()
  const queue: cytoscape.NodeSingular[] = [root]
  let result: cytoscape.Collection = cy.collection()

  while (queue.length > 0) {
    const current = queue.shift()!
    const id = current.id()
    if (visited.has(id)) continue
    visited.add(id)
    result = result.union(current)

    const connectedEdges = current.connectedEdges()
    result = result.union(connectedEdges)

    connectedEdges.forEach((edge) => {
      const neighbor = edge.source().id() === id ? edge.target() : edge.source()
      if (!visited.has(neighbor.id())) {
        queue.push(neighbor)
      }
    })
  }

  return result
}

function buildGraphLayout(
  mode: "tree" | "neural",
  options?: { randomize?: boolean; deterministic?: boolean }
): cytoscape.LayoutOptions {
  const randomize = options?.randomize ?? false
  const deterministic = options?.deterministic ?? false

  if (mode === "neural") {
    return {
      name: "cola",
      animate: !deterministic,
      refresh: 2,
      maxSimulationTime: deterministic ? 1500 : 5000,
      ungrabifyWhileSimulating: false,
      fit: false,
      padding: 60,
      randomize,
      avoidOverlap: true,
      nodeSpacing: (node: cytoscape.NodeSingular) => {
        const kind = node.data("kind")
        return kind === "collection" ? 30 : 15
      },
      edgeLength: (edge: cytoscape.EdgeSingular) => {
        const sourceKind = edge.source().data("kind")
        const targetKind = edge.target().data("kind")
        // Moderate stems from collection hub; tighter between leaf nodes
        if (sourceKind === "collection" || targetKind === "collection") return 80
        return 55
      },
      infinite: false,
      alphaTest: 0.02,
      initialUnconstrainedIterations: deterministic ? 250 : 500,
      initialUserConstraintIterations: deterministic ? 125 : 250,
      initialAllConstraintsIterations: deterministic ? 125 : 250,
    } as ColaLayoutOptions
  }

  return {
    name: "elk",
    fit: true,
    padding: 72,
    animate: false,
    nodeDimensionsIncludeLabels: true,
    elk: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.spacing.nodeNode": 40,
      "elk.layered.spacing.nodeNodeBetweenLayers": 64,
      "elk.layered.spacing.edgeNodeBetweenLayers": 42,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.bk.edgeStraightening": "IMPROVE_STRAIGHTNESS",
    },
  } as cytoscape.LayoutOptions
}

function buildGraphStylesheet(mode: "tree" | "neural", deterministic = false): cytoscape.StylesheetJson {
  const isNeural = mode === "neural"

  return [
    {
      selector: "node",
      style: {
        "background-color": "#334155",
        "label": isNeural ? "" : "data(label)",
        "text-wrap": "wrap",
        "text-max-width": "160",
        "font-size": isNeural ? 12 : 11,
        "font-family": "\"Outfit\", \"Space Grotesk\", sans-serif",
        "color": "#f8fafc",
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-color": "rgba(10,10,15,0.9)",
        "text-outline-width": 2.5,
        "shape": isNeural ? "ellipse" : "round-rectangle",
        "padding": isNeural ? "0px" : "10px",
        "width": isNeural ? 16 : "label",
        "height": isNeural ? 16 : "label",
        "transition-property": "background-color, border-color, border-width, width, height, opacity, shadow-blur, shadow-opacity, shadow-color",
        "transition-duration": deterministic ? 0 : 300,
        ...(isNeural ? {
          "background-fill": "radial-gradient",
          "background-gradient-stop-colors": "#e2e8f0 #94a3b8 #475569",
          "background-gradient-stop-positions": "0 40 100",
          "shadow-blur": 18,
          "shadow-color": "rgba(148, 163, 184, 0.45)",
          "shadow-opacity": 0.7,
          "border-width": 0,
        } : {
          "border-width": 1.5,
          "border-color": "rgba(255,255,255,0.16)",
        })
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-color": "#f7931a",
        "border-width": isNeural ? 0 : 3,
        "label": "data(label)",
        "width": isNeural ? 28 : "label",
        "height": isNeural ? 28 : "label",
        "shadow-blur": isNeural ? 35 : 15,
        "shadow-color": isNeural ? "rgba(247, 147, 26, 0.85)" : "rgba(247, 147, 26, 0.45)",
        "shadow-opacity": 1,
        "z-index": 100,
      },
    },
    {
      selector: "node.is-highlighted",
      style: {
        "label": "data(label)",
        "width": isNeural ? 24 : "label",
        "height": isNeural ? 24 : "label",
        "shadow-blur": isNeural ? 25 : 10,
        "shadow-color": isNeural ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.25)",
      },
    },
    {
      selector: "node.kind-collection",
      style: {
        "background-color": "#f7931a",
        "border-color": "rgba(255,255,255,0.4)",
        "font-size": 16,
        "font-weight": 800,
        "width": isNeural ? 42 : "label",
        "height": isNeural ? 42 : "label",
        ...(isNeural ? {
          "background-gradient-stop-colors": "#fef9c3 #f7931a #ea580c",
          "shadow-blur": 45,
          "shadow-color": "rgba(247, 147, 26, 0.65)",
          "shadow-opacity": 0.9,
        } : {
          "shadow-blur": 20,
          "shadow-color": "rgba(247, 147, 26, 0.65)",
          "shadow-opacity": 0.4,
        })
      },
    },
    {
      selector: "node.kind-field",
      style: {
        "background-color": "rgba(17, 24, 39, 0.96)",
        "border-color": "rgba(148, 163, 184, 0.22)",
        "font-size": 12,
        "font-weight": 700,
        ...(isNeural ? {
          "background-gradient-stop-colors": "#cffafe #06b6d4 #0891b2",
          "shadow-color": "rgba(6, 182, 212, 0.6)",
        } : {})
      },
    },
    {
      selector: "node.kind-claim",
      style: {
        "shape": "round-rectangle",
        "font-size": 10,
        ...(isNeural ? {
          "background-gradient-stop-colors": "#fbcfe8 #ec4899 #db2777",
          "shadow-color": "rgba(236, 72, 153, 0.6)",
        } : {})
      },
    },
    {
      selector: "node.kind-wiki_page",
      style: {
        "background-color": "#D6ED4E",
        "border-color": "rgba(214, 237, 78, 0.28)",
        "color": "#0a0a0f",
        "text-outline-color": "rgba(255,255,255,0.8)",
        ...(isNeural ? {
          "background-gradient-stop-colors": "#f7fee7 #d6ed4e #84cc16",
          "shadow-color": "rgba(214, 237, 78, 0.6)",
        } : {})
      },
    },
    {
      selector: "node.kind-source_event",
      style: {
        "background-color": "rgba(71, 85, 105, 0.92)",
        "border-color": "rgba(148, 163, 184, 0.22)",
        "font-size": 10,
        ...(isNeural ? {
          "background-gradient-stop-colors": "#dcfce7 #22c55e #16a34a",
          "shadow-color": "rgba(34, 197, 94, 0.6)",
        } : {})
      },
    },
    {
      selector: "node.kind-external_ref",
      style: {
        "background-color": "rgba(69, 26, 3, 0.92)",
        "border-style": "dashed",
        "border-color": "rgba(251, 191, 36, 0.32)",
        ...(isNeural ? {
          "background-gradient-stop-colors": "#fef3c7 #fbbf24 #d97706",
          "shadow-color": "rgba(251, 191, 36, 0.6)",
        } : {})
      },
    },
    {
      selector: "node.status-canonical",
      style: {
        "border-color": "#4ade80",
        "border-width": isNeural ? 0 : 2,
        ...(isNeural ? {
          "underlay-color": "#4ade80",
          "underlay-padding": 2,
          "underlay-opacity": 0.15,
        } : {})
      },
    },
    {
      selector: "node.status-draft",
      style: {
        "border-color": "#60a5fa",
        "border-width": isNeural ? 0 : 2,
      },
    },
    {
      selector: "node.status-disputed",
      style: {
        "border-color": "#fbbf24",
        "border-width": isNeural ? 0 : 2,
      },
    },
    {
      selector: "node.status-partial",
      style: {
        "border-color": "#fb7185",
        "border-width": isNeural ? 0 : 2,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": isNeural ? "unbundled-bezier" : "taxi",
        "control-point-distances": isNeural ? 30 : undefined,
        "control-point-weights": isNeural ? 0.5 : undefined,
        "taxi-direction": "rightward",
        "line-color": isNeural ? "rgba(148, 163, 184, 0.15)" : "rgba(148, 163, 184, 0.34)",
        "target-arrow-color": isNeural ? "rgba(148, 163, 184, 0.25)" : "rgba(148, 163, 184, 0.42)",
        "target-arrow-shape": isNeural ? "none" : "triangle",
        "arrow-scale": isNeural ? 0.5 : 0.8,
        "width": isNeural ? 1.0 : 1.4,
        "font-size": 9,
        "color": "#cbd5e1",
        "label": isNeural ? "" : "data(label)",
        "text-background-opacity": 1,
        "text-background-color": "rgba(10,10,15,0.82)",
        "text-background-padding": "2",
        "transition-property": "line-color, width, opacity, target-arrow-color",
        "transition-duration": 300,
      },
    },
    {
      selector: "edge.is-highlighted",
      style: {
        "line-color": isNeural ? "rgba(247, 147, 26, 0.7)" : "#f7931a",
        "target-arrow-color": isNeural ? "rgba(247, 147, 26, 0.8)" : "#f7931a",
        "width": isNeural ? 2.0 : 2.5,
        "opacity": 1,
        "label": "data(label)",
        "z-index": 50,
      },
    },
    {
      selector: "edge.status-canonical",
      style: {
        "line-color": "rgba(74, 222, 128, 0.7)",
        "target-arrow-color": "rgba(74, 222, 128, 0.88)",
      },
    },
    {
      selector: "edge.status-draft",
      style: {
        "line-color": "rgba(96, 165, 250, 0.7)",
        "target-arrow-color": "rgba(96, 165, 250, 0.88)",
      },
    },
    {
      selector: "edge.status-disputed",
      style: {
        "line-color": "rgba(251, 191, 36, 0.7)",
        "target-arrow-color": "rgba(251, 191, 36, 0.88)",
      },
    },
    {
      selector: "edge.status-partial",
      style: {
        "line-style": "dashed",
        "line-color": "rgba(244, 114, 182, 0.68)",
        "target-arrow-color": "rgba(244, 114, 182, 0.9)",
      },
    },
    {
      selector: ".is-faded",
      style: {
        "opacity": isNeural ? 0.08 : 0.14,
      },
    },
    {
      selector: ".is-highlighted",
      style: {
        "opacity": 1,
      },
    },
  ] as unknown as cytoscape.StylesheetJson
}
