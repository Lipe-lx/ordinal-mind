import { motion } from "motion/react"
import type { ScanProgress as ScanProgressType } from "../lib/types"

interface Props {
  progress: ScanProgressType
  inscriptionId: string
}

const PHASE_ORDER = ["metadata", "transfers", "mentions", "unisat", "complete"] as const
const PHASE_LABELS: Record<string, string> = {
  metadata: "Indexing Inscription Data",
  transfers: "Tracing On-Chain Provenance",
  mentions: "Aggregating Social Signals",
  unisat: "Enriching Asset Metadata",
  complete: "Consolidating Chronicle",
}

export function ScanProgress({ progress, inscriptionId }: Props) {
  const currentPhaseIndex = PHASE_ORDER.indexOf(
    progress.phase as (typeof PHASE_ORDER)[number]
  )

  const displayId = inscriptionId.length > 20
    ? `${inscriptionId.substring(0, 8)}…${inscriptionId.substring(inscriptionId.length - 4)}`
    : `#${inscriptionId}`

  return (
    <motion.div
      className="scan-progress engine-card"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="scan-progress-header">
        <div className="scan-progress-title-group">
          <div className="scan-progress-label">Memory Engine</div>
          <h2 className="scan-progress-main-title">Scanning Chronicle</h2>
        </div>
        <div className="scan-progress-id-box">
          <span className="id-label">ENTITY_ID</span>
          <span className="id-value">{displayId}</span>
        </div>
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
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1, duration: 0.4 }}
            >
              <div className="step-indicator">
                {isComplete ? (
                  <span className="indicator-dot done"></span>
                ) : isCurrent ? (
                  <span className="indicator-pulse active"></span>
                ) : (
                  <span className="indicator-dot pending"></span>
                )}
              </div>
              
              <div className="step-content">
                <span className="step-label">{PHASE_LABELS[phase]}</span>
                {isCurrent && (
                  <motion.span
                    className="step-detail"
                    key={progress.description}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {progress.description}
                  </motion.span>
                )}
              </div>

              {isComplete && <span className="step-status">VERIFIED</span>}
              {isCurrent && <span className="step-status active">ACTIVE</span>}
            </motion.div>
          )
        })}
      </div>

      <div className="scan-progress-visualization">
        <div className="bar-label">PROVENANCE_STREAM</div>
        <div className="scan-progress-bar-container">
          <div className="scan-progress-bar-track">
            <motion.div
              className="scan-progress-bar-fill"
              initial={{ width: "0%" }}
              animate={{
                width: `${((currentPhaseIndex + (isCurrentPhaseProgressing(progress) ? 0.5 : 0)) / PHASE_ORDER.length) * 100}%`,
              }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="fill-glow"></div>
            </motion.div>
          </div>
          <div className="bar-percentage">
            {Math.round(((currentPhaseIndex + (isCurrentPhaseProgressing(progress) ? 0.5 : 0)) / PHASE_ORDER.length) * 100)}%
          </div>
        </div>
      </div>

      <div className="scan-progress-footer">
        <div className="footer-status">
          <span className="status-bit"></span>
          RECOVERING IMMUTABLE RECORDS
        </div>
        <div className="footer-meta">
          NODE_OP: CHRONICLE_V1
        </div>
      </div>
    </motion.div>
  )
}

function isCurrentPhaseProgressing(progress: ScanProgressType) {
    // Simple heuristic to show the bar moving slightly ahead during a phase
    return progress.description && progress.description.length > 0;
}
