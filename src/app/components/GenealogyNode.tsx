import { motion, useMotionValue, useTransform, useSpring } from "motion/react"
import React, { memo, useRef } from "react"
import type { RelatedInscriptionSummary } from "../lib/types"
import { InscriptionMedia } from "./InscriptionMedia"

interface Props {
  id?: string
  inscription: RelatedInscriptionSummary
  label?: string
  isRoot?: boolean
  compact?: boolean
  isFeatured?: boolean
  onTap?: () => void
}

/**
 * GenealogyNode component optimized with React.memo and dimension caching
 * to ensure smooth 60fps interaction during 3D tilt.
 */
export const GenealogyNode = memo(({ id, inscription, label, isRoot, compact, isFeatured, onTap }: Props) => {
  const numberLabel = inscription.inscription_number != null ? `#${inscription.inscription_number}` : "Pending"

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  // Smooth springs for premium feel
  const springX = useSpring(mouseX, { stiffness: 200, damping: 25 })
  const springY = useSpring(mouseY, { stiffness: 200, damping: 25 })

  const rotateX = useTransform(springY, [-0.5, 0.5], [8, -8])
  const rotateY = useTransform(springX, [-0.5, 0.5], [-8, 8])

  // Optimization: Cache dimensions on entry to avoid layout thrashing during mouse move
  const rectRef = useRef<DOMRect | null>(null)

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    rectRef.current = e.currentTarget.getBoundingClientRect()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rectRef.current) return
    const rect = rectRef.current
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    mouseX.set(x)
    mouseY.set(y)
  }

  const handleMouseLeave = () => {
    mouseX.set(0)
    mouseY.set(0)
    rectRef.current = null
  }

  return (
    <motion.div
      id={id}
      className={`genealogy-node ${isRoot ? "is-root" : ""} ${compact ? "is-compact" : ""} ${isFeatured ? "is-featured" : ""}`}
      whileHover={{ scale: 1.05, y: -8, transition: { duration: 0.3 } }}
      whileTap={{ scale: 0.98 }}
      onTap={onTap}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ 
        rotateX, 
        rotateY, 
        perspective: 1000,
        transformStyle: "preserve-3d",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        willChange: "transform" // Promote to compositor layer
      }}
    >
      <div className="node-card glass-card" style={{ transform: "translateZ(30px)" }}>
        {isRoot && (
          <motion.div 
            className="node-root-indicator"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{ 
              transform: "translateZ(40px)", // High depth inside the card
              zIndex: 100,
              opacity: 1
            }}
          >
            Focus
          </motion.div>
        )}
        <div className="node-image" style={{ transform: "translateZ(10px)", position: "relative" }}>
          <InscriptionMedia inscription={inscription} />
          {/* Click capture overlay to prevent iframes/media from swallowing events */}
          <div style={{ position: "absolute", inset: 0, zIndex: 20 }} />
          {label && !compact && (
            <div className="node-role-badge" style={{ transform: "translateZ(20px)", zIndex: 30 }}>{label}</div>
          )}
        </div>
        <div className="node-info" style={{ transform: "translateZ(15px)" }}>
          <div className="node-number">{numberLabel}</div>
        </div>
      </div>
    </motion.div>
  )
})

GenealogyNode.displayName = "GenealogyNode"

