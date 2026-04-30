import { motion } from "motion/react"
import type { ScanProgress as ScanProgressType } from "../lib/types"

interface Props {
  progress: ScanProgressType
  inscriptionId: string
}

const PHASE_ORDER = ["metadata", "transfers", "mentions", "unisat", "complete"] as const
const PHASE_LABELS: Record<string, string> = {
  metadata: "Inscription Data",
  transfers: "Transfer History",
  mentions: "Collector Signals",
  unisat: "UniSat Enrichment",
  complete: "Building Timeline",
}
const PHASE_ICONS: Record<string, string> = {
  metadata: "🔍",
  transfers: "⛓️",
  mentions: "✦",
  unisat: "🔶",
  complete: "✨",
}

export function ScanProgress({ progress, inscriptionId }: Props) {
  const currentPhaseIndex = PHASE_ORDER.indexOf(
    progress.phase as (typeof PHASE_ORDER)[number]
  )

  // Short display ID
  const displayId = inscriptionId.length > 20
    ? `${inscriptionId.substring(0, 8)}…${inscriptionId.substring(inscriptionId.length - 4)}`
    : `#${inscriptionId}`

  return (
    <motion.div
      className="scan-progress glass-card"
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="scan-progress-header">
        <div className="scan-progress-title">
          <span className="scan-progress-title-icon">⛏️</span>
          <span>Scanning Chronicle</span>
        </div>
        <span className="scan-progress-id-badge">{displayId}</span>
      </div>

      <div className="scan-progress-steps">
        {PHASE_ORDER.map((phase, index) => {
          const isComplete = index < currentPhaseIndex
          const isCurrent = index === currentPhaseIndex

          return (
            <motion.div
              key={phase}
              className={`scan-progress-step ${
                isComplete ? "complete" : isCurrent ? "current" : "future"
              }`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08, duration: 0.3 }}
            >
              <div className="scan-progress-step-icon">
                {isComplete ? (
                  <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                    ✓
                  </motion.span>
                ) : isCurrent ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  >
                    ◌
                  </motion.span>
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              
              <div className="scan-progress-step-label">
                <span className="phase-emoji">{PHASE_ICONS[phase]}</span>
                <span>{PHASE_LABELS[phase]}</span>
              </div>

              {isCurrent && (
                <motion.span
                  className="scan-progress-step-detail"
                  key={progress.description}
                  initial={{ opacity: 0, x: 5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {progress.description}
                </motion.span>
              )}
            </motion.div>
          )
        })}
      </div>

      <div className="scan-progress-bar-container">
        <div className="scan-progress-bar-track">
          <motion.div
            className="scan-progress-bar-fill"
            initial={{ width: "0%" }}
            animate={{
              width: `${((currentPhaseIndex + (isCurrentPhaseProgressing(progress) ? 0.5 : 0)) / PHASE_ORDER.length) * 100}%`,
            }}
            transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          />
        </div>
      </div>

      <div className="scan-progress-footer">
        <span>Processing</span>
        <span>Phase {currentPhaseIndex + 1} of {PHASE_ORDER.length}</span>
      </div>
    </motion.div>
  )
}

function isCurrentPhaseProgressing(progress: ScanProgressType) {
    // Simple heuristic to show the bar moving slightly ahead during a phase
    return progress.description && progress.description.length > 0;
}
