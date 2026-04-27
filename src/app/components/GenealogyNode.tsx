import { motion } from "motion/react"
import type { RelatedInscriptionSummary } from "../lib/types"
import { InscriptionMedia } from "./InscriptionMedia"

interface Props {
  id?: string
  inscription: RelatedInscriptionSummary
  label?: string
  isRoot?: boolean
  compact?: boolean
  isFeatured?: boolean
  onClick?: () => void
}

export function GenealogyNode({ id, inscription, label, isRoot, compact, isFeatured, onClick }: Props) {
  const numberLabel = inscription.inscription_number != null ? `#${inscription.inscription_number}` : "Pending"

  return (
    <motion.div
      id={id}
      className={`genealogy-node ${isRoot ? "is-root" : ""} ${compact ? "is-compact" : ""} ${isFeatured ? "is-featured" : ""}`}
      whileHover={{ scale: 1.02, y: -4, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="node-card glass-card">
        <div className="node-image">
          <InscriptionMedia inscription={inscription} />
          {label && !compact && (
            <div className="node-role-badge">{label}</div>
          )}
        </div>
        <div className="node-info">
          <div className="node-number">{numberLabel}</div>
        </div>
      </div>
      
      {isRoot && <div className="node-root-indicator">Focus</div>}
    </motion.div>
  )
}
