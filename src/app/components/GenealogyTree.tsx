import { motion, AnimatePresence, useMotionValue, useTransform, type MotionValue } from "motion/react"
import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from "react"
import { createPortal } from "react-dom"
import type { ChronicleResponse, RelatedInscriptionSummary } from "../lib/types"
import {
  buildGenealogyConnections,
  buildGenealogyDescendantColumns,
  buildGenealogyLevels,
  GENEALOGY_VISIBLE_LIMITS,
} from "../lib/genealogy"
import { computeGenealogyAutoFitScale, GENEALOGY_LAYOUT_SETTLE_DELAYS_MS } from "../lib/genealogyLayout"
import { zoomAtPoint, type Point2D } from "../lib/genealogyViewport"
import { formatContentTypeLabel } from "../lib/media"
import { useDeterministicRendering } from "../lib/useDeterministicRendering"
import { GenealogyNode } from "./GenealogyNode"
import { InscriptionMedia } from "./InscriptionMedia"

/**
 * Calculates a smooth cubic bezier path between two points in local coordinate space.
 */
function calculateBezierPath(startX: number, startY: number, endX: number, endY: number): string {
  // Guard against invalid inputs that could cause "M undefined undefined" errors
  if (
    typeof startX !== "number" || isNaN(startX) ||
    typeof startY !== "number" || isNaN(startY) ||
    typeof endX !== "number" || isNaN(endX) ||
    typeof endY !== "number" || isNaN(endY)
  ) {
    return ""
  }

  // Prevent SVG gradient zero-width/height bounding box clipping bug on perfectly straight lines
  const safeEndX = Math.abs(startX - endX) < 0.1 ? endX + 0.1 : endX
  const safeEndY = Math.abs(startY - endY) < 0.1 ? endY + 0.1 : endY

  const midY = (startY + safeEndY) / 2
  return `M ${startX} ${startY} C ${startX} ${midY}, ${safeEndX} ${midY}, ${safeEndX} ${safeEndY}`
}

interface ConnectionProps {
  startId: string
  endId: string
  nodePositions: Record<string, { x: number, y: number }>
}

/**
 * Stable Connection component.
 */
const Connection = memo(({ startId, endId, nodePositions }: ConnectionProps) => {
  const start = nodePositions[startId]
  const end = nodePositions[endId]

  if (!start || !end) return null

  const pathData = calculateBezierPath(start.x, start.y, end.x, end.y)
  if (!pathData) return null

  return (
    <path 
      d={pathData}
      className="genealogy-path animate-flow"
      stroke="url(#connection-grad)"
      strokeWidth="3.5"
      fill="none"
      style={{ opacity: 0.7 }}
    />
  )
})

Connection.displayName = "Connection"

interface BackgroundProps {
  x: MotionValue<number>
  y: MotionValue<number>
}

/**
 * Technical 3D Background with parallax layers.
 */
const GenealogyBackground = memo(({ x, y }: BackgroundProps) => {
  // Parallax multipliers for depth layers
  const gridX = useTransform(x, (v) => v * 0.4)
  const gridY = useTransform(y, (v) => v * 0.4)
  
  const dotsX = useTransform(x, (v) => v * 0.8)
  const dotsY = useTransform(y, (v) => v * 0.8)



  return (
    <div className="genealogy-bg">
      {/* 3D Grid Layer */}
      <motion.div 
        className="genealogy-bg-layer"
        style={{ x: gridX, y: gridY }}
      >
        <div className="genealogy-bg-grid" />
      </motion.div>

      {/* 3D Dots Layer */}
      <motion.div 
        className="genealogy-bg-layer"
        style={{ x: dotsX, y: dotsY }}
      >
        <div className="genealogy-bg-dots" />
      </motion.div>



      <div className="genealogy-bg-scanline" />
    </div>
  )
})

GenealogyBackground.displayName = "GenealogyBackground"

interface Props {
  chronicle: ChronicleResponse
}

type GenealogyViewMode = "tree" | "grouped"
const MIN_GENEALOGY_SCALE = 0.1
const MAX_GENEALOGY_SCALE = 3
const TAP_SUPPRESSION_MS = 220

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest("button, a, input, textarea, select, label, summary, [role='button']"))
}

export const GenealogyTree = memo(({ chronicle }: Props) => {
  const deterministicRendering = useDeterministicRendering()
  const [selectedNode, setSelectedNode] = useState<RelatedInscriptionSummary | null>(null)
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number, y: number }>>({})
  const [viewMode, setViewMode] = useState<GenealogyViewMode>("grouped")
  const [isFullscreen, setIsFullscreen] = useState(false)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const hasUserInteracted = useRef(false)
  const settleTimeoutsRef = useRef<number[]>([])
  const syncRafRef = useRef<number | null>(null)
  
  // Zoom & Pan State
  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // Parallax effect only when dragging
  const bgX = useTransform(x, (vx) => (vx as number) * 0.1)
  const bgY = useTransform(y, (vy) => (vy as number) * 0.1)

  // Pinch-to-zoom state
  const activePointers = useRef(new Map<number, { x: number, y: number }>())
  const lastPinchDistance = useRef<number | null>(null)
  const suppressNodeTapUntilRef = useRef(0)

  const root = useMemo<RelatedInscriptionSummary>(() => {
    return {
      inscription_id: chronicle.meta.inscription_id,
      inscription_number: chronicle.meta.inscription_number,
      content_type: chronicle.meta.content_type,
      content_url: chronicle.meta.content_url,
      genesis_timestamp: chronicle.meta.genesis_timestamp,
    } as unknown as RelatedInscriptionSummary
  }, [
    chronicle.meta.inscription_id,
    chronicle.meta.inscription_number,
    chronicle.meta.content_type,
    chronicle.meta.content_url,
    chronicle.meta.genesis_timestamp
  ])

  const protocol = chronicle.collection_context.protocol
  const parents = useMemo(() => protocol.parents?.items ?? [], [protocol.parents?.items])
  const grandparents = useMemo(() => protocol.grandparents?.items ?? [], [protocol.grandparents?.items])
  const greatGrandparents = useMemo(() => protocol.greatGrandparents?.items ?? [], [protocol.greatGrandparents?.items])
  const children = useMemo(() => protocol.children?.items ?? [], [protocol.children?.items])
  const grandchildren = useMemo(() => protocol.grandchildren?.items ?? [], [protocol.grandchildren?.items])
  const totalChildren = protocol.children?.total_count ?? 0
  const visibleChildren = useMemo(
    () => children.slice(0, GENEALOGY_VISIBLE_LIMITS.children),
    [children]
  )
  const descendantColumns = useMemo(
    () => buildGenealogyDescendantColumns(visibleChildren, grandchildren, GENEALOGY_VISIBLE_LIMITS.grandchildren),
    [visibleChildren, grandchildren]
  )
  const renderedGrandchildren = useMemo(
    () => [
      ...descendantColumns.columns.flatMap((column) => column.grandchildren),
      ...descendantColumns.unassignedGrandchildren,
    ],
    [descendantColumns]
  )
  const hiddenGrandchildrenCount = useMemo(
    () =>
      descendantColumns.columns.reduce((sum, column) => sum + column.hiddenGrandchildrenCount, 0)
      + descendantColumns.hiddenUnassignedGrandchildrenCount,
    [descendantColumns]
  )

  const levels = useMemo(() => buildGenealogyLevels({
    greatGrandparents,
    grandparents,
    parents,
    root,
    children: visibleChildren,
    grandchildren: renderedGrandchildren,
  }), [greatGrandparents, grandparents, parents, root, visibleChildren, renderedGrandchildren])

  const connections = useMemo(
    () => buildGenealogyConnections(levels, root.inscription_id),
    [levels, root.inscription_id]
  )
  const visibleGrandchildren = renderedGrandchildren

  const isMeasuring = useRef(false)
  /**
   * Measure all node positions relative to the tree container.
   * Throttled via requestAnimationFrame to ensure high performance during zoom/pan.
   */
  const measurePositions = useCallback(() => {
    if (!treeRef.current || isMeasuring.current) return
    
    isMeasuring.current = true
    requestAnimationFrame(() => {
      if (!treeRef.current) {
        isMeasuring.current = false
        return
      }

      const treeRect = treeRef.current.getBoundingClientRect()
      // Calculate the actual rendered scale from DOM instead of relying on internal motion values.
      const offsetWidth = treeRef.current.offsetWidth || 1
      const actualScale = treeRect.width / offsetWidth || 1
      
      const positions: Record<string, { x: number, y: number }> = {}
      
      const nodes = treeRef.current.querySelectorAll(".genealogy-node")
      nodes.forEach(node => {
        const nodeEl = node as HTMLElement
        if (nodeEl.id) {
          const rect = nodeEl.getBoundingClientRect()
          positions[nodeEl.id] = {
            x: (rect.left - treeRect.left + rect.width / 2) / actualScale,
            y: (rect.top - treeRect.top + rect.height / 2) / actualScale
          }
        }
      })
      
      setNodePositions(positions)
      isMeasuring.current = false
    })
  }, [])

  const applyAutoFit = useCallback(() => {
    if (!containerRef.current || !treeRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const treeWidth = treeRef.current.offsetWidth
    const treeHeight = treeRef.current.offsetHeight
    const autoScale = computeGenealogyAutoFitScale({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      treeWidth,
      treeHeight,
    })

    scale.set(autoScale)
    x.set(0)
    y.set(0)
  }, [scale, x, y])

  const syncTreeLayout = useCallback((withAutoFit: boolean) => {
    if (syncRafRef.current !== null) {
      cancelAnimationFrame(syncRafRef.current)
    }

    syncRafRef.current = requestAnimationFrame(() => {
      syncRafRef.current = null
      if (withAutoFit && !hasUserInteracted.current) {
        applyAutoFit()
      }
      measurePositions()
    })
  }, [applyAutoFit, measurePositions])

  const clearPendingLayoutSync = useCallback(() => {
    settleTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    settleTimeoutsRef.current = []

    if (syncRafRef.current !== null) {
      cancelAnimationFrame(syncRafRef.current)
      syncRafRef.current = null
    }
  }, [])

  const markUserInteracted = useCallback(() => {
    hasUserInteracted.current = true
  }, [])

  const suppressNodeTap = useCallback((durationMs: number = TAP_SUPPRESSION_MS) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    suppressNodeTapUntilRef.current = Math.max(suppressNodeTapUntilRef.current, now + durationMs)
  }, [])

  const handleNodeTap = useCallback((node: RelatedInscriptionSummary) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    if (now < suppressNodeTapUntilRef.current) return
    setSelectedNode(node)
  }, [])

  const getTreeTransformOrigin = useCallback((): Point2D | null => {
    if (!containerRef.current || !treeRef.current) return null

    const containerRect = containerRef.current.getBoundingClientRect()
    const treeRect = treeRef.current.getBoundingClientRect()

    return {
      x: treeRect.left - containerRect.left + treeRect.width / 2,
      y: treeRect.top - containerRect.top + treeRect.height / 2,
    }
  }, [])

  const applyZoomAtPoint = useCallback((anchor: Point2D, nextScale: number) => {
    const origin = getTreeTransformOrigin()
    if (!origin) return

    const next = zoomAtPoint({
      anchor,
      transformOrigin: origin,
      current: {
        scale: scale.get(),
        tx: x.get(),
        ty: y.get(),
      },
      nextScale,
      minScale: MIN_GENEALOGY_SCALE,
      maxScale: MAX_GENEALOGY_SCALE,
    })

    scale.set(next.scale)
    x.set(next.tx)
    y.set(next.ty)
  }, [getTreeTransformOrigin, scale, x, y])

  // Setup ResizeObserver for robust measurement
  useEffect(() => {
    const treeElement = treeRef.current
    if (!treeElement) return

    const observer = new ResizeObserver(() => {
      syncTreeLayout(true)
    })

    observer.observe(treeElement)
    
    // Also observe the container to handle window/container resizing
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    const mutationObserver = new MutationObserver(() => {
      syncTreeLayout(true)
    })
    mutationObserver.observe(treeElement, {
      childList: true,
      subtree: true,
    })

    const mediaLifecycleHandler = () => {
      syncTreeLayout(true)
    }
    const mediaLifecycleEvents = ["load", "loadeddata", "canplay", "error"]
    mediaLifecycleEvents.forEach((eventName) => {
      treeElement.addEventListener(eventName, mediaLifecycleHandler, true)
    })

    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
      mediaLifecycleEvents.forEach((eventName) => {
        treeElement.removeEventListener(eventName, mediaLifecycleHandler, true)
      })
    }
  }, [syncTreeLayout, isFullscreen])

  // Initial settle window: keep syncing while media and animated nodes finish mounting.
  useEffect(() => {
    hasUserInteracted.current = false
    clearPendingLayoutSync()

    const settleDelays = deterministicRendering ? [0] : GENEALOGY_LAYOUT_SETTLE_DELAYS_MS
    settleTimeoutsRef.current = settleDelays.map((delayMs) =>
      window.setTimeout(() => {
        syncTreeLayout(true)
      }, delayMs)
    )

    return clearPendingLayoutSync
  }, [chronicle.meta.inscription_id, clearPendingLayoutSync, deterministicRendering, syncTreeLayout])

  useEffect(() => {
    hasUserInteracted.current = false
    syncTreeLayout(true)
  }, [syncTreeLayout, viewMode, isFullscreen])

  useEffect(() => {
    if (!isFullscreen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isFullscreen])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target)) return

    if (containerRef.current) {
      try {
        if (e.pointerType !== "mouse") {
          containerRef.current.setPointerCapture(e.pointerId)
        }
      } catch {
        // Ignore pointer capture failures in unsupported edge-cases.
      }
    }

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    
    if (activePointers.current.size === 2) {
      const pointers = Array.from(activePointers.current.values())
      const dist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y)
      lastPinchDistance.current = dist
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (activePointers.current.size === 2 && containerRef.current) {
      suppressNodeTap()
      markUserInteracted()
      const pointers = Array.from(activePointers.current.values())
      const dist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y)
      
      if (lastPinchDistance.current !== null && dist > 0) {
        const delta = dist / lastPinchDistance.current
        const currentScale = scale.get()
        const newScale = currentScale * delta
        
        if (newScale !== currentScale) {
          const rect = containerRef.current.getBoundingClientRect()
          const anchor = {
            x: (pointers[0].x + pointers[1].x) / 2 - rect.left,
            y: (pointers[0].y + pointers[1].y) / 2 - rect.top,
          }

          applyZoomAtPoint(anchor, newScale)
        }
      }
      lastPinchDistance.current = dist
    }
  }, [applyZoomAtPoint, markUserInteracted, scale, suppressNodeTap])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (containerRef.current?.hasPointerCapture(e.pointerId)) {
      try {
        containerRef.current.releasePointerCapture(e.pointerId)
      } catch {
        // Ignore release failures if pointer ownership already changed.
      }
    }

    activePointers.current.delete(e.pointerId)
    if (activePointers.current.size < 2) {
      lastPinchDistance.current = null
    }
  }, [])

  // Handle Zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      markUserInteracted()
      const delta = e.deltaY * -0.0012
      const currentScale = scale.get()
      const newScale = currentScale + delta
      
      if (newScale !== currentScale && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const anchor = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        }
        applyZoomAtPoint(anchor, newScale)
      }
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [applyZoomAtPoint, isFullscreen, markUserInteracted, scale])

  // Identify the single oldest progenitor in the visible tree
  const oldestNodeId = useMemo(() => {
    const candidates = greatGrandparents.length > 0 
      ? greatGrandparents 
      : grandparents.length > 0 
        ? grandparents 
        : parents.length > 0 ? parents : []
    
    if (candidates.length === 0) return null
    
    // Sort by inscription number to find the absolute oldest
    return candidates.slice().sort((a, b) => {
      const numA = a.inscription_number ?? Infinity
      const numB = b.inscription_number ?? Infinity
      return numA - numB
    })[0]?.inscription_id
  }, [greatGrandparents, grandparents, parents])

  const renderMoreCard = useCallback((hiddenCount: number, isCompact: boolean = false) => {
    if (hiddenCount <= 0) return null;
    return (
      <motion.div 
        className={`genealogy-node ${isCompact ? "is-compact" : ""}`}
        whileHover={deterministicRendering ? undefined : { scale: 1.02, y: -4, transition: { duration: 0.2 } }}
        initial={deterministicRendering ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={deterministicRendering ? { duration: 0 } : undefined}
      >
        <div 
          className="node-card glass-card genealogy-node-more"
          style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", justifyContent: "center", textAlign: "center", flex: 1, boxSizing: "border-box" }}
        >
          <div className="node-more-label" style={{ fontSize: "0.65rem", color: "var(--accent-primary)", fontWeight: 600, lineHeight: 1.2, marginBottom: "2px" }}>
            View full lineage
          </div>
          <div className="node-more-links" style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
            <a href={`https://ordinals.com/inscription/${root.inscription_id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ fontSize: "0.6rem", padding: "4px", width: "100%", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", minHeight: "24px" }} onClick={e => e.stopPropagation()}>
              ordinals.com ↗
            </a>
            <a href={`https://ord.net/inscription/${root.inscription_id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ fontSize: "0.6rem", padding: "4px", width: "100%", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", minHeight: "24px" }} onClick={e => e.stopPropagation()}>
              ord.net ↗
            </a>
          </div>
        </div>
      </motion.div>
    );
  }, [deterministicRendering, root.inscription_id]);

  const handleDoubleClick = useCallback(() => {
    markUserInteracted()
    applyAutoFit()
    syncTreeLayout(false)
  }, [applyAutoFit, markUserInteracted, syncTreeLayout])

  const content = (
    <motion.div 
      className={`genealogy-container ${isFullscreen ? "is-fullscreen" : ""}`} 
      ref={containerRef}
      style={{ touchAction: "none" }}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPanStart={deterministicRendering ? undefined : () => {
        markUserInteracted()
        suppressNodeTap()
      }}
      onPan={deterministicRendering ? undefined : (_e, info) => {
        // Only pan for tracked non-interactive pointers.
        if (activePointers.current.size !== 1) return
        suppressNodeTap()
        x.set(x.get() + info.delta.x)
        y.set(y.get() + info.delta.y)
      }}
    >
      <GenealogyBackground x={bgX} y={bgY} />
      <div className="genealogy-toolbar">
        <button
          type="button"
          className={`genealogy-toolbar-btn ${isFullscreen ? "is-active" : ""}`}
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 3 6 6-6 6M9 21 3 15l6-6"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          )}
        </button>
        <div className="genealogy-view-toggle" role="tablist" aria-label="Genealogy view mode">
          <button
            type="button"
            className={`genealogy-view-toggle-btn ${viewMode === "grouped" ? "is-active" : ""}`}
            onClick={() => setViewMode("grouped")}
            aria-pressed={viewMode === "grouped"}
          >
            Grouped
          </button>
          <button
            type="button"
            className={`genealogy-view-toggle-btn ${viewMode === "tree" ? "is-active" : ""}`}
            onClick={() => setViewMode("tree")}
            aria-pressed={viewMode === "tree"}
          >
            Lineage
          </button>
        </div>
      </div>

      <motion.div 
        className="genealogy-tree" 
        ref={treeRef}
        style={{ x, y, scale }}
      >
        {/* SVG Connections Layer */}
        <svg 
          className="genealogy-connections" 
          width="100%" 
          height="100%"
          style={{ position: "absolute", top: 0, left: 0, overflow: "visible", zIndex: -1 }}
        >
          <defs>
            <linearGradient id="connection-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--accent-glow)" stopOpacity="0.05" />
              <stop offset="20%" stopColor="var(--accent-primary)" stopOpacity="0.3" />
              <stop offset="50%" stopColor="var(--accent-primary)" stopOpacity="0.6" />
              <stop offset="80%" stopColor="var(--accent-primary)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          
          {/* Universal Connector: Global Relationship & Hierarchical Fallback */}
          {connections.map(conn => {
            if (!nodePositions[conn.startId] || !nodePositions[conn.endId]) return null
            return (
              <Connection 
                key={conn.key}
                startId={conn.startId}
                endId={conn.endId}
                nodePositions={nodePositions}
              />
            )
          })}
        </svg>

        {/* Great-Grandparents Row */}
        <div className="genealogy-row ancestors" id="great-grandparents-row">
          {greatGrandparents.slice(0, GENEALOGY_VISIBLE_LIMITS.greatGrandparents).map((ggp) => (
            <GenealogyNode 
              key={ggp.inscription_id}
              id={`node-${ggp.inscription_id}`}
              inscription={ggp}
              label="Great-Grandparent"
              isFeatured={ggp.inscription_id === oldestNodeId}
              onTap={() => handleNodeTap(ggp)}
            />
          ))}
          {greatGrandparents.length > GENEALOGY_VISIBLE_LIMITS.greatGrandparents && renderMoreCard(greatGrandparents.length - GENEALOGY_VISIBLE_LIMITS.greatGrandparents, false)}
        </div>

        {/* Grandparents Row */}
        <div className="genealogy-row ancestors" id="grandparents-row">
          {grandparents.slice(0, GENEALOGY_VISIBLE_LIMITS.grandparents).map((gp) => (
            <GenealogyNode 
              key={gp.inscription_id}
              id={`node-${gp.inscription_id}`}
              inscription={gp}
              label="Grandparent"
              isFeatured={gp.inscription_id === oldestNodeId}
              onTap={() => handleNodeTap(gp)}
            />
          ))}
          {grandparents.length > GENEALOGY_VISIBLE_LIMITS.grandparents && renderMoreCard(grandparents.length - GENEALOGY_VISIBLE_LIMITS.grandparents, false)}
        </div>

        {/* Parents Row */}
        <div className="genealogy-row parents" id="parents-row">
          {parents.slice(0, GENEALOGY_VISIBLE_LIMITS.parents).map((p) => (
            <GenealogyNode 
              key={p.inscription_id}
              id={`node-${p.inscription_id}`}
              inscription={p}
              label="Parent"
              isFeatured={p.inscription_id === oldestNodeId}
              onTap={() => handleNodeTap(p)}
            />
          ))}
          {parents.length > GENEALOGY_VISIBLE_LIMITS.parents && renderMoreCard(parents.length - GENEALOGY_VISIBLE_LIMITS.parents, false)}
        </div>

        {/* Root Node Row */}
        <div className="genealogy-row root">
          <GenealogyNode 
            id="node-root"
            inscription={root}
            label="Root"
            isRoot
            onTap={() => handleNodeTap(root)}
          />
        </div>

        {viewMode === "tree" ? (
          <div className="genealogy-row descendants" id="descendants-row">
            {descendantColumns.columns.map(({ child, grandchildren: groupedGrandchildren, hiddenGrandchildrenCount: columnHiddenGrandchildrenCount }) => (
              <div key={child.inscription_id} className="descendant-column">
                <GenealogyNode
                  id={`node-${child.inscription_id}`}
                  inscription={child}
                  compact
                  onTap={() => handleNodeTap(child)}
                />
                <div className="descendant-grandchildren">
                  {groupedGrandchildren.map((grandchild) => (
                    <GenealogyNode
                      key={grandchild.inscription_id}
                      id={`node-${grandchild.inscription_id}`}
                      inscription={grandchild}
                      compact
                    onTap={() => handleNodeTap(grandchild)}
                  />
                  ))}
                  {columnHiddenGrandchildrenCount > 0
                    ? renderMoreCard(columnHiddenGrandchildrenCount, true)
                    : null}
                </div>
              </div>
            ))}
            {descendantColumns.unassignedGrandchildren.length > 0 && (
              <div className="descendant-column descendant-column--unassigned">
                <div className="descendant-grandchildren">
                  {descendantColumns.unassignedGrandchildren.map((grandchild) => (
                    <GenealogyNode
                      key={grandchild.inscription_id}
                      id={`node-${grandchild.inscription_id}`}
                      inscription={grandchild}
                      compact
                      onTap={() => handleNodeTap(grandchild)}
                    />
                  ))}
                  {descendantColumns.hiddenUnassignedGrandchildrenCount > 0
                    ? renderMoreCard(descendantColumns.hiddenUnassignedGrandchildrenCount, true)
                    : null}
                </div>
              </div>
            )}
            {totalChildren > GENEALOGY_VISIBLE_LIMITS.children && (
              <div className="descendant-column descendant-column--overflow">
                {renderMoreCard(totalChildren - GENEALOGY_VISIBLE_LIMITS.children, true)}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="genealogy-row children" id="children-row">
              <div className="children-grid">
                {visibleChildren.map((child) => (
                  <GenealogyNode
                    key={child.inscription_id}
                    id={`node-${child.inscription_id}`}
                    inscription={child}
                    compact
                    onTap={() => handleNodeTap(child)}
                  />
                ))}
                {totalChildren > GENEALOGY_VISIBLE_LIMITS.children && renderMoreCard(totalChildren - GENEALOGY_VISIBLE_LIMITS.children, true)}
              </div>
            </div>

            <div className="genealogy-row grandchildren" id="grandchildren-row">
              <div className="children-grid">
                {visibleGrandchildren.map((grandchild) => (
                  <GenealogyNode
                    key={grandchild.inscription_id}
                    id={`node-${grandchild.inscription_id}`}
                    inscription={grandchild}
                    compact
                    onTap={() => handleNodeTap(grandchild)}
                  />
                ))}
                {hiddenGrandchildrenCount > 0 && renderMoreCard(hiddenGrandchildrenCount, true)}
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* Overlays */}

      <AnimatePresence>
        {selectedNode && (
          <motion.div 
            className="node-detail-overlay"
            initial={deterministicRendering ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={deterministicRendering ? undefined : { opacity: 0 }}
            onClick={() => setSelectedNode(null)}
          >
            <motion.div 
              className="node-detail-card glass-card"
              initial={deterministicRendering ? false : { scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={deterministicRendering ? undefined : { scale: 0.9, y: 20 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <button className="node-detail-close" onClick={() => setSelectedNode(null)}>✕</button>
              <div className="node-detail-content">
                <div className="node-detail-image">
                  <InscriptionMedia inscription={selectedNode} showMeta={false} preferPreviewForHtml />
                </div>
                <div className="node-detail-info">
                  <div className="node-detail-header">
                    <h3>#{selectedNode.inscription_number ?? "Pending"}</h3>
                    <span className="node-badge">Artifact</span>
                  </div>
                  <code className="node-detail-id">{selectedNode.inscription_id}</code>
                  <div className="node-detail-stats">
                    {selectedNode.genesis_timestamp && (
                      <div className="stat-item">
                        <label>Minted</label>
                        <span>{new Date(selectedNode.genesis_timestamp as string | number).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="stat-item">
                      <label>Content Type</label>
                      <span>{formatContentTypeLabel(selectedNode.content_type)}</span>
                    </div>
                  </div>
                  <div className="node-detail-actions">
                    <a href={`/chronicle/${selectedNode.inscription_id}`} className="btn-premium" style={{ width: "100%" }}>
                      <span>Explore Chronicle ↗</span>
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
    </motion.div>
  )

  if (isFullscreen && typeof document !== "undefined") {
    return createPortal(content, document.body)
  }

  return content
})

GenealogyTree.displayName = "GenealogyTree"
