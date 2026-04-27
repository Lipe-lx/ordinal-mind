import { motion, AnimatePresence, useMotionValue, useSpring, animate, useTransform, type MotionValue } from "motion/react"
import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from "react"
import type { ChronicleResponse, RelatedInscriptionSummary } from "../lib/types"
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
      filter="url(#glow)"
      style={{ opacity: 0.8 }}
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

  const [particles] = useState(() => Array.from({ length: 30 }).map((_, i) => ({
    id: i,
    size: Math.random() * 3 + 1.5,
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    duration: Math.random() * 20 + 10,
    delay: Math.random() * 10
  })))

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

      {/* Data Particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="bg-particle"
          style={{
            width: p.size,
            height: p.size,
            top: p.top,
            left: p.left,
          }}
          animate={{
            y: [-40, 40],
            x: [-20, 20],
            opacity: [0.05, 0.2, 0.05],
            scale: [1, 1.5, 1],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "linear"
          }}
        />
      ))}

      <div className="genealogy-bg-scanline" />
    </div>
  )
})

GenealogyBackground.displayName = "GenealogyBackground"

interface Props {
  chronicle: ChronicleResponse
}

export function GenealogyTree({ chronicle }: Props) {
  const [selectedNode, setSelectedNode] = useState<RelatedInscriptionSummary | null>(null)
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number, y: number }>>({})
  
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const hasAutoFitted = useRef<string | null>(null)
  
  // Zoom & Pan State
  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  
  // Spring physics
  const springScale = useSpring(scale, { stiffness: 120, damping: 24 })

  // Mouse Parallax
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e
      const { innerWidth, innerHeight } = window
      // Normalize mouse position from -1 to 1 and multiply by intensity
      mouseX.set((clientX / innerWidth - 0.5) * 40)
      mouseY.set((clientY / innerHeight - 0.5) * 40)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [mouseX, mouseY])

  // Combine dragging parallax + mouse parallax for the background layers
  const bgX = useTransform([x, mouseX], ([vx, vmx]) => (vx as number) * 0.1 + (vmx as number))
  const bgY = useTransform([y, mouseY], ([vy, vmy]) => (vy as number) * 0.1 + (vmy as number))

  const root = useMemo<RelatedInscriptionSummary>(() => ({
    inscription_id: chronicle.meta.inscription_id,
    inscription_number: chronicle.meta.inscription_number,
    content_type: chronicle.meta.content_type,
    content_url: chronicle.meta.content_url,
    genesis_timestamp: chronicle.meta.genesis_timestamp,
  }), [
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
  const totalChildren = protocol.children?.total_count ?? 0

  /**
   * Measure all node positions relative to the tree container.
   */
  const measurePositions = useCallback(() => {
    if (!treeRef.current) return
    
    const treeRect = treeRef.current.getBoundingClientRect()
    const currentScale = springScale.get() || scale.get() || 1
    
    const positions: Record<string, { x: number, y: number }> = {}
    
    const nodes = treeRef.current.querySelectorAll(".genealogy-node")
    nodes.forEach(node => {
      if (node.id) {
        const rect = node.getBoundingClientRect()
        positions[node.id] = {
          x: (rect.left - treeRect.left + rect.width / 2) / currentScale,
          y: (rect.top - treeRect.top + rect.height / 2) / currentScale
        }
      }
    })
    
    setNodePositions(positions)
  }, [scale, springScale])

  // Setup ResizeObserver for robust measurement
  useEffect(() => {
    if (!treeRef.current) return

    const observer = new ResizeObserver(() => {
      measurePositions()
    })

    observer.observe(treeRef.current)
    
    // Also observe the container to handle window/container resizing
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [measurePositions])

  // Initial Auto-fit
  useEffect(() => {
    if (hasAutoFitted.current === chronicle.meta.inscription_id) return

    const timer = setTimeout(() => {
      if (!containerRef.current || !treeRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const treeWidth = treeRef.current.offsetWidth
      const treeHeight = treeRef.current.offsetHeight
      
      const padding = 0
      const availableWidth = containerRect.width
      const availableHeight = containerRect.height
      
      const scaleX = availableWidth / treeWidth
      const scaleY = availableHeight / treeHeight
      // Add a 10% zoom boost to make it feel "closer" by default
      const autoScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 1.1, 0.15), 1.2)
      
      scale.set(autoScale)
      x.set(0)
      y.set(0)
      
      hasAutoFitted.current = chronicle.meta.inscription_id
      
      requestAnimationFrame(() => {
        setTimeout(measurePositions, 100)
      })
    }, 400)
    
    return () => clearTimeout(timer)
  }, [chronicle.meta.inscription_id, measurePositions, scale, x, y])

  // Handle Zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.0012
      const currentScale = scale.get()
      const newScale = Math.min(Math.max(currentScale + delta, 0.1), 3.0)
      scale.set(newScale)
    }

    container.addEventListener("wheel", onWheel, { passive: false })
    return () => container.removeEventListener("wheel", onWheel)
  }, [scale])

  // Pre-calculate all known IDs to validate explicit relationships
  const allKnownIds = useMemo(() => new Set([
    root.inscription_id,
    ...parents.map(n => n.inscription_id),
    ...grandparents.map(n => n.inscription_id),
    ...greatGrandparents.map(n => n.inscription_id),
    ...children.map(n => n.inscription_id)
  ]), [root.inscription_id, parents, grandparents, greatGrandparents, children]);

  // Identify the single oldest progenitor in the visible tree
  const oldestNodeId = useMemo(() => {
    const candidates = greatGrandparents.length > 0 
      ? greatGrandparents 
      : grandparents.length > 0 
        ? grandparents 
        : parents.length > 0 ? parents : []
    
    if (candidates.length === 0) return null
    
    // Sort by inscription number to find the absolute oldest
    return [...candidates].sort((a, b) => {
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
    if (!containerRef.current || !treeRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const treeWidth = treeRef.current.offsetWidth;
    const treeHeight = treeRef.current.offsetHeight;
    
    const padding = 0;
    const availableWidth = containerRect.width;
    const availableHeight = containerRect.height;
    
    const scaleX = availableWidth / treeWidth;
    const scaleY = availableHeight / treeHeight;
    // Add a 10% zoom boost to make it feel "closer" by default
    const autoScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 1.1, 0.15), 1.2);
    
    // Scale is already linked to a spring, so we just set it
    scale.set(autoScale);
    
    // Animate x and y smoothly with elastic physics
    animate(x, 0, { type: "spring", stiffness: 120, damping: 15, mass: 1 });
    animate(y, 0, { type: "spring", stiffness: 120, damping: 15, mass: 1 });
  }, [scale, x, y]);

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
              <stop offset="0%" stopColor="var(--accent-glow)" stopOpacity="0.1" />
              <stop offset="20%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
              <stop offset="50%" stopColor="var(--accent-primary)" stopOpacity="0.8" />
              <stop offset="80%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent-glow)" stopOpacity="0.1" />
            </linearGradient>
            {/* filterUnits="userSpaceOnUse" prevents the blur from being clipped when drawing perfectly straight lines (width=0) */}
            <filter id="glow" filterUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">
              <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Ancestry Connections (Hierarchical fallback guarantees connectivity) */}
          
          {/* 1. Parents -> Root (Flowing down) */}
          {parents.map((p) => (
            <Connection 
              key={`root-parent-${p.inscription_id}`}
              startId={`node-${p.inscription_id}`}
              endId="node-root"
              nodePositions={nodePositions}
            />
          ))}

          {/* 2. Older Ancestor -> Ancestor (Flowing down) */}
          {[
            { current: parents, olderLevel: grandparents },
            { current: grandparents, olderLevel: greatGrandparents }
          ].flatMap(({ current, olderLevel }) => 
            current.map((node) => {
              const explicitRelations = node.related_to_ids || [];
              const validExplicitRelations = explicitRelations.filter(id => allKnownIds.has(id));

              // For connections, we want to go from OlderLevel to Current node
              // But node.related_to_ids contains IDs of OLDER nodes (parents)
              // So we connect OlderId -> NodeId
              
              const relationsToUse = validExplicitRelations.length > 0 
                ? validExplicitRelations 
                : olderLevel.map(n => n.inscription_id);

              return relationsToUse.map((relatedId) => (
                <Connection 
                  key={`${node.inscription_id}-${relatedId}`}
                  startId={`node-${relatedId}`}
                  endId={`node-${node.inscription_id}`}
                  nodePositions={nodePositions}
                />
              ))
            })
          )}

          {/* Root -> Children Connections */}
          {children.slice(0, 9).map((child) => (
            <Connection 
              key={`root-child-${child.inscription_id}`}
              startId="node-root" 
              endId={`node-${child.inscription_id}`} 
              nodePositions={nodePositions}
            />
          ))}
        </svg>

        {/* Great-Grandparents Row */}
        <div className="genealogy-row ancestors" id="great-grandparents-row">
          {greatGrandparents.slice(0, 9).map((ggp) => (
            <GenealogyNode 
              key={ggp.inscription_id}
              id={`node-${ggp.inscription_id}`}
              inscription={ggp}
              label="Great-Grandparent"
              isFeatured={ggp.inscription_id === oldestNodeId}
              onTap={() => setSelectedNode(ggp)}
            />
          ))}
          {greatGrandparents.length > 9 && renderMoreCard(greatGrandparents.length - 9, false)}
        </div>

        {/* Grandparents Row */}
        <div className="genealogy-row ancestors" id="grandparents-row">
          {grandparents.slice(0, 9).map((gp) => (
            <GenealogyNode 
              key={gp.inscription_id}
              id={`node-${gp.inscription_id}`}
              inscription={gp}
              label="Grandparent"
              isFeatured={gp.inscription_id === oldestNodeId}
              onTap={() => setSelectedNode(gp)}
            />
          ))}
          {grandparents.length > 9 && renderMoreCard(grandparents.length - 9, false)}
        </div>

        {/* Parents Row */}
        <div className="genealogy-row parents" id="parents-row">
          {parents.slice(0, 9).map((p) => (
            <GenealogyNode 
              key={p.inscription_id}
              id={`node-${p.inscription_id}`}
              inscription={p}
              label="Parent"
              isFeatured={p.inscription_id === oldestNodeId}
              onTap={() => setSelectedNode(p)}
            />
          ))}
          {parents.length > 9 && renderMoreCard(parents.length - 9, false)}
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
            {children.slice(0, 9).map((child) => (
              <GenealogyNode 
                key={child.inscription_id}
                id={`node-${child.inscription_id}`}
                inscription={child}
                compact
                onTap={() => setSelectedNode(child)}
              />
            ))}
            {totalChildren > 9 && renderMoreCard(totalChildren - 9, true)}
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
                  <InscriptionMedia inscription={selectedNode} />
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
                    {selectedNode.content_type && (
                      <div className="stat-item">
                        <label>Type</label>
                        <span>{selectedNode.content_type.includes("/") ? selectedNode.content_type.split("/")[1].toUpperCase() : selectedNode.content_type}</span>
                      </div>
                    )}
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
}
