import { motion, AnimatePresence, useMotionValue, useSpring, animate, useTransform, type MotionValue } from "motion/react"
import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from "react"
import type { ChronicleResponse, RelatedInscriptionSummary } from "../lib/types"
import { buildGenealogyConnections, buildGenealogyLevels, GENEALOGY_VISIBLE_LIMITS } from "../lib/genealogy"
import { computeGenealogyAutoFitScale, GENEALOGY_LAYOUT_SETTLE_DELAYS_MS } from "../lib/genealogyLayout"
import { formatContentTypeLabel } from "../lib/media"
import { GenealogyNode } from "./GenealogyNode"
import { InscriptionMedia } from "./InscriptionMedia"

/**
 * Calculates a smooth cubic bezier path between two points in local coordinate space.
 */
function calculateBezierPath(startX: number, startY: number, endX: number, endY: number): string {
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

export const GenealogyTree = memo(({ chronicle }: Props) => {
  const [selectedNode, setSelectedNode] = useState<RelatedInscriptionSummary | null>(null)
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number, y: number }>>({})
  
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const hasUserInteracted = useRef(false)
  const settleTimeoutsRef = useRef<number[]>([])
  const syncRafRef = useRef<number | null>(null)
  
  // Zoom & Pan State
  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  
  // Spring physics
  const springScale = useSpring(scale, { stiffness: 120, damping: 24 })

  // Parallax effect only when dragging
  const bgX = useTransform(x, (vx) => (vx as number) * 0.1)
  const bgY = useTransform(y, (vy) => (vy as number) * 0.1)

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
  const totalGrandchildren = protocol.grandchildren?.total_count ?? 0

  const levels = useMemo(() => buildGenealogyLevels({
    greatGrandparents,
    grandparents,
    parents,
    root,
    children,
    grandchildren,
  }), [greatGrandparents, grandparents, parents, root, children, grandchildren])

  const connections = useMemo(
    () => buildGenealogyConnections(levels, root.inscription_id),
    [levels, root.inscription_id]
  )

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
      // Calculate the ACTUAL rendered scale from DOM to be independent of spring state
      const actualScale = treeRect.width / treeRef.current.offsetWidth || 1
      
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
  }, [syncTreeLayout])

  // Initial settle window: keep syncing while media and animated nodes finish mounting.
  useEffect(() => {
    hasUserInteracted.current = false
    clearPendingLayoutSync()

    settleTimeoutsRef.current = GENEALOGY_LAYOUT_SETTLE_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => {
        syncTreeLayout(true)
      }, delayMs)
    )

    return clearPendingLayoutSync
  }, [chronicle.meta.inscription_id, clearPendingLayoutSync, syncTreeLayout])

  // Handle Zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      markUserInteracted()
      const delta = e.deltaY * -0.0012
      const currentScale = scale.get()
      const newScale = Math.min(Math.max(currentScale + delta, 0.1), 3.0)
      scale.set(newScale)
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [markUserInteracted, scale])

  // Note: We removed the springScale.on("change") listener here because the SVG 
  // is nested within the scaled container. Connections remain stable during zoom.


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
        whileHover={{ scale: 1.02, y: -4, transition: { duration: 0.2 } }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
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
  }, [root.inscription_id]);

  const handleDoubleClick = useCallback(() => {
    markUserInteracted()
    applyAutoFit()
    // Animate x and y smoothly with elastic physics
    animate(x, 0, { type: "spring", stiffness: 120, damping: 15, mass: 1 })
    animate(y, 0, { type: "spring", stiffness: 120, damping: 15, mass: 1 })
    syncTreeLayout(false)
  }, [applyAutoFit, markUserInteracted, syncTreeLayout, x, y])

  return (
    <div 
      className="genealogy-container" 
      ref={containerRef}
      style={{ touchAction: "none" }}
      onDoubleClick={handleDoubleClick}
    >
      <GenealogyBackground x={bgX} y={bgY} />

      <motion.div 
        className="genealogy-tree" 
        ref={treeRef}
        drag
        dragMomentum={false}
        onDragStart={markUserInteracted}
        style={{ x, y, scale: springScale }}
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
              onTap={() => setSelectedNode(ggp)}
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
              onTap={() => setSelectedNode(gp)}
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
              onTap={() => setSelectedNode(p)}
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
            onTap={() => setSelectedNode(root)}
          />
        </div>

        {/* Children Row */}
        <div className="genealogy-row children" id="children-row">
          <div className="children-grid">
            {children.slice(0, GENEALOGY_VISIBLE_LIMITS.children).map((child) => (
              <GenealogyNode 
                key={child.inscription_id}
                id={`node-${child.inscription_id}`}
                inscription={child}
                compact
                onTap={() => setSelectedNode(child)}
              />
            ))}
            {totalChildren > GENEALOGY_VISIBLE_LIMITS.children && renderMoreCard(totalChildren - GENEALOGY_VISIBLE_LIMITS.children, true)}
          </div>
        </div>

        {/* Grandchildren Row */}
        <div className="genealogy-row grandchildren" id="grandchildren-row">
          <div className="children-grid">
            {grandchildren.slice(0, GENEALOGY_VISIBLE_LIMITS.grandchildren).map((grandchild) => (
              <GenealogyNode
                key={grandchild.inscription_id}
                id={`node-${grandchild.inscription_id}`}
                inscription={grandchild}
                compact
                onTap={() => setSelectedNode(grandchild)}
              />
            ))}
            {totalGrandchildren > GENEALOGY_VISIBLE_LIMITS.grandchildren && renderMoreCard(totalGrandchildren - GENEALOGY_VISIBLE_LIMITS.grandchildren, true)}
          </div>
        </div>
      </motion.div>

      {/* Overlays */}

      <AnimatePresence>
        {selectedNode && (
          <motion.div 
            className="node-detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedNode(null)}
          >
            <motion.div 
              className="node-detail-card glass-card"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <button className="node-detail-close" onClick={() => setSelectedNode(null)}>✕</button>
              <div className="node-detail-content">
                <div className="node-detail-image">
                  <InscriptionMedia inscription={selectedNode} showMeta={false} />
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
                    <a href={`/chronicle/${selectedNode.inscription_id}`} className="btn btn-primary" style={{ width: "100%" }}>
                      Explore Chronicle ↗
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
    </div>
  )
})

GenealogyTree.displayName = "GenealogyTree"
