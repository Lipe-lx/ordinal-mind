import ReactMarkdown from "react-markdown"
import type { SynthesisPhase } from "../lib/byok/useSynthesize"

interface Props {
  /** Final sanitized narrative text (markdown) */
  narrative: string | null
  /** Progressive streaming text shown during generation */
  streamingText: string
  /** Current synthesis phase */
  phase: SynthesisPhase
  /** Elapsed time in seconds */
  elapsed: number
  /** Provider name for the loading badge */
  providerName?: string
  /** Model name for the loading badge */
  modelName?: string
  /** Error message */
  error?: string | null
  /** Called when user clicks Generate */
  onGenerate?: () => void
  /** Called when user clicks Cancel */
  onCancel?: () => void
}

const PHASE_LABELS: Record<string, { icon: string; text: string }> = {
  connecting: { icon: "⚡", text: "Connecting to provider…" },
  analyzing: { icon: "⛓️", text: "Analyzing on-chain data…" },
  streaming: { icon: "✍️", text: "Synthesizing Chronicle…" },
  sanitizing: { icon: "🔍", text: "Cleaning up narrative…" },
}

/** Specialized renderer for Chronicle narrative with streaming, loading states, and enhanced typography. */
export function NarrativeRenderer({
  narrative,
  streamingText,
  phase,
  elapsed,
  providerName,
  modelName,
  error,
  onGenerate,
  onCancel,
}: Props) {
  // Error state
  if (phase === "error" && error) {
    return (
      <div className="narrative-section">
        <div className="narrative-error">
          <span className="narrative-error-icon">⚠️</span>
          <p>{error}</p>
          {onGenerate && (
            <button className="btn btn-secondary btn-sm" onClick={onGenerate}>
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  // Loading / streaming state
  if (phase !== "idle" && phase !== "done") {
    const phaseInfo = PHASE_LABELS[phase] || PHASE_LABELS.connecting

    return (
      <div className="narrative-section">
        <div className="narrative-loading">
          <div className="narrative-loading-header">
            <div className="narrative-loading-phase">
              <span className="narrative-phase-icon">{phaseInfo.icon}</span>
              <span className="narrative-phase-text">{phaseInfo.text}</span>
            </div>
            <div className="narrative-loading-meta">
              {providerName && modelName && (
                <span className="narrative-model-badge">
                  {providerName} · {modelName}
                </span>
              )}
              {elapsed >= 10 && (
                <span className="narrative-elapsed">{elapsed}s</span>
              )}
            </div>
          </div>

          {/* Progress dots */}
          <div className="narrative-progress-dots">
            {Object.keys(PHASE_LABELS).map((p) => (
              <span
                key={p}
                className={`narrative-dot ${
                  p === phase ? "active" : isPhaseComplete(p, phase) ? "complete" : ""
                }`}
              />
            ))}
          </div>

          {/* Progressive streaming text */}
          {streamingText && (
            <div className="narrative-stream-preview">
              <ReactMarkdown>{streamingText}</ReactMarkdown>
              <span className="narrative-cursor" />
            </div>
          )}

          {onCancel && (
            <button className="btn btn-ghost btn-sm narrative-cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  }

  // Empty state — no narrative yet
  if (!narrative) {
    return (
      <div className="narrative-section">
        <div className="narrative-empty">
          <p className="narrative-empty-text">
            Generate an AI-powered Chronicle narrative from the factual timeline above.
          </p>
          {onGenerate && (
            <button className="btn btn-primary btn-sm" onClick={onGenerate}>
              ✨ Generate Chronicle
            </button>
          )}
        </div>
      </div>
    )
  }

  // Final narrative display
  return (
    <div className="narrative-section narrative-final">
      <div className="narrative-content">
        <ReactMarkdown
          components={{
            // Enhanced paragraph rendering
            p: ({ children }) => (
              <p className="narrative-paragraph">{enhanceContent(children)}</p>
            ),
          }}
        >
          {narrative}
        </ReactMarkdown>
      </div>
    </div>
  )
}

// --- Helpers ---

const PHASE_ORDER = Object.keys(PHASE_LABELS)

function isPhaseComplete(phase: string, currentPhase: string): boolean {
  return PHASE_ORDER.indexOf(phase) < PHASE_ORDER.indexOf(currentPhase)
}

/**
 * Enhance inline content: detect Bitcoin addresses and block heights,
 * wrap them in interactive elements.
 */
function enhanceContent(children: React.ReactNode): React.ReactNode {
  if (typeof children !== "string") return children

  const text = children as string

  // Replace Bitcoin addresses with styled spans
  const addressRegex = /(bc1[a-z0-9]{8,})/gi
  const blockRegex = /#(\d{3,}(?:,\d{3})*)/g

  // Simple enhancement: just return styled text for now
  // Full implementation would parse and create React elements
  if (addressRegex.test(text) || blockRegex.test(text)) {
    return <span className="narrative-enhanced">{text}</span>
  }

  return children
}
