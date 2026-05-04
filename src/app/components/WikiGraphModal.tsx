import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router"
import cytoscape from "cytoscape"
import cytoscapeElk from "cytoscape-elk"
import type { WikiGraphNode } from "../lib/types"
import {
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<WikiGraphFilters>(createDefaultWikiGraphFilters)
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchWikiGraph>>>(null)
  const [prevOpen, setPrevOpen] = useState(open)
  const deferredSearch = useDeferredValue(filters.search)

  if (open && !prevOpen) {
    setPrevOpen(true)
    setFilters(createDefaultWikiGraphFilters())
    setPayload(null)
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



  useEffect(() => {
    const container = containerRef.current
    if (!container || !filteredPayload) return

    const cy = cytoscape({
      container,
      elements: toCytoscapeElements(filteredPayload),
      layout: buildGraphLayout(),
      wheelSensitivity: 0.8,
      minZoom: 0.1,
      maxZoom: 18.0,
      style: buildGraphStylesheet(),
    })

    const clearHover = () => {
      cy.elements().removeClass("is-faded is-highlighted")
    }

    const emphasizeNeighborhood = (nodeId: string | null) => {
      clearHover()
      if (!nodeId) return

      const center = cy.getElementById(nodeId)
      if (!center.length) return
      const neighborhood = center.closedNeighborhood()
      cy.elements().difference(neighborhood).addClass("is-faded")
      neighborhood.addClass("is-highlighted")
    }

    cy.on("mouseover", "node", (event) => {
      emphasizeNeighborhood(event.target.id())
    })

    cy.on("mouseover", "edge", (event) => {
      clearHover()
      const edge = event.target
      const neighborhood = edge.connectedNodes().union(edge)
      cy.elements().difference(neighborhood).addClass("is-faded")
      neighborhood.addClass("is-highlighted")
    })

    cy.on("mouseout", () => {
      clearHover()
    })


    cy.on("dbltap", "node", (event) => {
      const node = filteredPayload.nodes.find((item) => item.id === event.target.id())
      if (!node) return
      const target = resolveNavigationTarget(node)
      if (target) navigate(target)
    })

    cy.on("dbltap", (event) => {
      if (event.target === cy) {
        fitGraph()
      }
    })

    const initialFocus = filteredPayload.focus_node_id ?? filteredPayload.nodes[0]?.id ?? null
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

    cy.one("layoutstop", fitGraph)
    requestAnimationFrame(() => {
      fitGraph()
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [filteredPayload, navigate])

  const visibleWarnings = filteredPayload?.warnings.slice(0, 2) ?? []

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wiki-graph-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={dialogRef}
            className="wiki-graph-modal glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiki-graph-title"
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ duration: 0.22 }}
          >
            <header className="wiki-graph-header">
              <h2 id="wiki-graph-title">Wiki Atlas</h2>
              <div className="wiki-graph-header-actions">
                {wikiStatusLabel && <span className="wiki-graph-status-pill">{wikiStatusLabel}</span>}
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </header>

            <div className="wiki-graph-toolbar">
              <label className="wiki-graph-search">
                <input
                  className="input-field"
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="Search"
                />
              </label>

              <div className="wiki-graph-filter-group">
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

              <div className="wiki-graph-tool-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => cyRef.current?.fit(undefined, 80)}>
                  Fit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const nodeId = filteredPayload?.focus_node_id
                    if (!nodeId || !cyRef.current) return
                    const node = cyRef.current.getElementById(nodeId)
                    if (!node.length) return
                    cyRef.current.animate({
                      fit: { eles: node.closedNeighborhood(), padding: 90 },
                      duration: 260,
                    })
                  }}
                >
                  Recenter
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const cy = cyRef.current
                    if (!cy) return
                    cy.layout(buildGraphLayout()).run()
                  }}
                >
                  Reset Layout
                </button>
              </div>
            </div>

            <div className="wiki-graph-body">
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
                    {visibleWarnings.length > 0 && (
                      <div className="wiki-graph-inline-warnings">
                        {visibleWarnings.map((warning) => (
                          <span key={warning}>{warning}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (typeof document === "undefined") return null
  return createPortal(content, document.body)
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


function buildGraphLayout(): cytoscape.LayoutOptions {
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

function buildGraphStylesheet(): cytoscape.StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        "background-color": "#334155",
        "border-width": 1.5,
        "border-color": "rgba(255,255,255,0.16)",
        "label": "data(label)",
        "text-wrap": "wrap",
        "text-max-width": "160",
        "font-size": 11,
        "font-family": "\"Space Grotesk\", sans-serif",
        "color": "#f8fafc",
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-color": "rgba(10,10,15,0.85)",
        "text-outline-width": 2,
        "shape": "round-rectangle",
        "padding": "10",
        "width": "label",
        "height": "label",
      },
    },
    {
      selector: "node.kind-collection",
      style: {
        "background-color": "#f7931a",
        "border-color": "rgba(247,147,26,0.48)",
        "font-size": 14,
        "font-weight": 700,
      },
    },
    {
      selector: "node.kind-field",
      style: {
        "background-color": "rgba(17, 24, 39, 0.96)",
        "border-color": "rgba(148, 163, 184, 0.22)",
        "font-size": 12,
        "font-weight": 700,
      },
    },
    {
      selector: "node.kind-claim",
      style: {
        "shape": "round-rectangle",
        "font-size": 10,
      },
    },
    {
      selector: "node.kind-wiki_page",
      style: {
        "background-color": "rgba(14, 116, 144, 0.92)",
        "border-color": "rgba(103, 232, 249, 0.28)",
      },
    },
    {
      selector: "node.kind-source_event",
      style: {
        "background-color": "rgba(71, 85, 105, 0.92)",
        "border-color": "rgba(148, 163, 184, 0.22)",
        "font-size": 10,
      },
    },
    {
      selector: "node.kind-external_ref",
      style: {
        "background-color": "rgba(69, 26, 3, 0.92)",
        "border-style": "dashed",
        "border-color": "rgba(251, 191, 36, 0.32)",
      },
    },
    {
      selector: "node.status-canonical",
      style: {
        "border-color": "#4ade80",
        "border-width": 2,
      },
    },
    {
      selector: "node.status-draft",
      style: {
        "border-color": "#60a5fa",
        "border-width": 2,
      },
    },
    {
      selector: "node.status-disputed",
      style: {
        "border-color": "#fbbf24",
        "border-width": 2,
      },
    },
    {
      selector: "node.status-partial",
      style: {
        "border-color": "#fb7185",
        "border-width": 2,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "taxi",
        "taxi-direction": "rightward",
        "line-color": "rgba(148, 163, 184, 0.34)",
        "target-arrow-color": "rgba(148, 163, 184, 0.42)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "width": 1.4,
        "font-size": 9,
        "color": "#cbd5e1",
        "label": "data(label)",
        "text-background-opacity": 1,
        "text-background-color": "rgba(10,10,15,0.82)",
        "text-background-padding": "2",
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
        "opacity": 0.14,
      },
    },
    {
      selector: ".is-highlighted",
      style: {
        "opacity": 1,
      },
    },
  ]
}
