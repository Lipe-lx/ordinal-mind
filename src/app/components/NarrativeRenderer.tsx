import { useState } from "react"
import ReactMarkdown from "react-markdown"
import type { SynthesisPhase } from "../lib/byok/useSynthesize"
import type { ResearchLog } from "../lib/byok/toolExecutor"
import type { SynthesisMode } from "../lib/byok/context"
import { linkifyBrands } from "../lib/brandLinks"

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
  /** Actual request mode used by the adapter */
  inputMode?: SynthesisMode | null
  /** Research activity logs */
  researchLogs?: ResearchLog[]
  /** Whether research capability is enabled (keys present) */
  researchEnabled?: boolean
  /** Called when user clicks Generate */
  onGenerate?: () => void
  /** Primary button label for empty/error states */
  actionLabel?: string
  /** Empty state helper copy */
  emptyMessage?: string
  /** Called when user clicks Cancel */
  onCancel?: () => void
}

const PHASE_LABELS: Record<string, { icon: string; text: string }> = {
  connecting: { icon: "⚡", text: "Connecting to provider…" },
  analyzing: { icon: "⛓️", text: "Analyzing on-chain data…" },
  researching: { icon: "🔎", text: "Researching cultural context…" },
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
  inputMode,
  researchLogs = [],
  researchEnabled = false,
  onGenerate,
  actionLabel = "✨ Generative Chronicle",
  emptyMessage = "Generate an AI-powered Chronicle narrative from the factual timeline above.",
  onCancel,
}: Props) {
  const [showLogs, setShowLogs] = useState(false)

  // Error state
  if (phase === "error" && error) {
    return (
      <div className="narrative-section">
        <div className="narrative-error">
          <span className="narrative-error-icon">⚠️</span>
          <p>{error}</p>
          {onGenerate && (
            <button className="btn btn-secondary btn-sm" onClick={onGenerate}>
              {actionLabel}
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
              {inputMode && (
                <span className="narrative-model-badge">
                  {inputMode === "image+context" ? "image + context" : "text-only"}
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

          {/* Research Activity Logs (In-progress) */}
          {(researchLogs.length > 0 || phase === "researching") && (
            <div className="narrative-loading-logs">
              <ResearchLogs logs={researchLogs} phase={phase} />
            </div>
          )}

          {/* Progressive streaming text */}
          {streamingText && (
            <div className="narrative-stream-preview">
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p className="narrative-paragraph">{enhanceContent(children)}</p>
                  ),
                }}
              >
                {streamingText}
              </ReactMarkdown>
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
            {emptyMessage}
          </p>
          {onGenerate && (
            <button className="btn btn-primary btn-sm" onClick={onGenerate}>
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  // Final narrative display
  const hasResearch = researchLogs.length > 0 || researchEnabled

  return (
    <div className="narrative-section narrative-final">
      {hasResearch && (
        <div className="narrative-final-logs">
          <div 
            className={`narrative-logs-toggle ${showLogs ? "is-expanded" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setShowLogs(!showLogs)}
            onKeyDown={(e) => e.key === "Enter" && setShowLogs(!showLogs)}
          >
            <svg className="narrative-logs-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {showLogs ? (
                <path d="m18 15-6-6-6 6" />
              ) : (
                <path d="m6 9 6 6 6-6" />
              )}
            </svg>
            <span className="narrative-logs-toggle-text">
              Research Activity
              <span className="narrative-logs-count">{researchLogs.length}</span>
            </span>
          </div>
          {showLogs && (
            <div className="narrative-logs-expanded">
              <ResearchLogs logs={researchLogs} phase={phase} />
            </div>
          )}
        </div>
      )}
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

  // 1. Detect Bitcoin addresses and block heights for special styling
  const addressRegex = /(bc1[a-z0-9]{8,})/gi
  const blockRegex = /#(\d{3,}(?:,\d{3})*)/g
  const needsEnhancement = addressRegex.test(text) || blockRegex.test(text)

  // 2. Apply brand linkification
  const brandLinked = linkifyBrands(text)
  
  // 3. Wrap in enhanced span if it has on-chain identifiers
  if (needsEnhancement) {
    return <span className="narrative-enhanced">{brandLinked}</span>
  }

  return brandLinked
}

// --- Sub-components ---

function ResearchLogs({ logs, phase }: { logs: ResearchLog[], phase: string }) {
  // If we have no logs and are not currently researching, only return something if it's "done"
  // so the user can see that research was attempted but nothing found.
  if (logs.length === 0 && phase !== "researching") {
    if (phase === "done" || phase === "streaming" || phase === "sanitizing") {
      return (
        <div className="narrative-research-logs">
          <div className="narrative-log-item">
            <div className="narrative-log-row">
              <span className="narrative-log-status">🔍</span>
              <span className="narrative-log-tool">Researcher</span>
              <span className="narrative-log-args">No external tools were triggered.</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="narrative-research-logs">
      {logs.length > 0 ? (
        logs.map((log) => (
          <div key={log.id} className={`narrative-log-item ${log.status}`}>
            <div className="narrative-log-row">
              <span className="narrative-log-status">
                {log.status === "running" ? "⏳" : log.status === "done" ? "✅" : "❌"}
              </span>
              <span className="narrative-log-tool">{log.tool.replace("_", " ")}</span>
              <span className="narrative-log-args">
                {String(log.args.query || log.args.question || log.args.keyword || log.args.coin_id || JSON.stringify(log.args))}
              </span>
            </div>
            {log.result && (
              <div className="narrative-log-result">
                <span className="narrative-log-result-icon">↳</span>
                <span className="narrative-log-result-text">{log.result}</span>
              </div>
            )}
            {log.error && <span className="narrative-log-error">{log.error}</span>}
          </div>
        ))
      ) : phase === "researching" ? (
        <div className="narrative-log-item running">
          <div className="narrative-log-row">
            <span className="narrative-log-status">🤔</span>
            <span className="narrative-log-tool">Researcher</span>
            <span className="narrative-log-args">Evaluating collection context...</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
