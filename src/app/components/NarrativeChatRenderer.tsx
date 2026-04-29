import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { linkifyBrands } from "../lib/brandLinks"
import type { ChatMessage, ChatThreadSummary } from "../lib/byok/chatTypes"
import type { ResearchLog } from "../lib/byok/toolExecutor"
import type { SynthesisMode } from "../lib/byok/context"
import type { SynthesisPhase } from "../lib/byok/useChronicleNarrativeChat"
import { ChatHistoryModal } from "./ChatHistoryModal"

interface Props {
  messages: ChatMessage[]
  activeThreadId: string | null
  threadHistory: ChatThreadSummary[]
  streamingText: string
  streamingThought: string
  phase: SynthesisPhase
  elapsed: number
  providerName?: string
  modelName?: string
  inputMode?: SynthesisMode | null
  wikiStatusLabel?: string
  wikiStatusError?: string | null
  error?: string | null
  inputError?: string | null
  researchLogs?: ResearchLog[]
  hasKey: boolean
  collectionSlug?: string
  onSend: (prompt: string) => Promise<void> | void
  onNewThread: () => void
  onResumeThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => boolean
  onDeleteThread: (threadId: string) => boolean
  onRetry: () => Promise<void> | void
  onCancel: () => void
  onOpenBYOK: () => void
}

export function NarrativeChatRenderer({
  messages,
  activeThreadId,
  threadHistory,
  streamingText,
  streamingThought,
  phase,
  elapsed,
  providerName,
  modelName,
  inputMode,
  wikiStatusLabel,
  wikiStatusError,
  error,
  inputError,
  researchLogs = [],
  hasKey,
  collectionSlug,
  onSend,
  onNewThread,
  onResumeThread,
  onRenameThread,
  onDeleteThread,
  onRetry,
  onCancel,
  onOpenBYOK,
}: Props) {
  const [prompt, setPrompt] = useState("")
  const [showLogs, setShowLogs] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [localInputError, setLocalInputError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  const isLoading = phase !== "idle" && phase !== "done" && phase !== "error"
  const transcript = useMemo(() => messages, [messages])

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, streamingText])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    await sendCurrentPrompt()
  }

  const sendCurrentPrompt = async () => {
    const nextPrompt = prompt.trim()
    if (!nextPrompt) {
      setLocalInputError("Enter a prompt before sending.")
      return
    }

    setLocalInputError(null)
    setPrompt("")
    await onSend(nextPrompt)
  }

  return (
    <div className="narrative-chat-shell">
      <ChatHistoryModal
        open={showHistory}
        activeThreadId={activeThreadId}
        threads={threadHistory}
        onSelectThread={onResumeThread}
        onRenameThread={onRenameThread}
        onDeleteThread={onDeleteThread}
        onClose={() => setShowHistory(false)}
      />

      <div
        className="narrative-chat-transcript"
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label="Chronicle chat transcript"
      >
        {transcript.length === 0 && !streamingText && (
          <div className="narrative-chat-empty">
            <p>
              {hasKey
                ? (isLoading
                    ? "Generating response..."
                    : "Start a new conversation about this inscription or open a previous session.")
                : "Configure BYOK to unlock Chronicle chat. The factual timeline remains fully available."}
            </p>
            {!hasKey && (
              <button className="btn btn-primary btn-sm" onClick={onOpenBYOK}>
                🔑 Configure BYOK
              </button>
            )}
          </div>
        )}

        {transcript.map((message) => (
          <article key={message.id} className={`chat-line ${message.role === "assistant" ? "assistant" : "user"}`}>
            <div className="chat-line-content">
              {message.role === "assistant" ? (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => (
                      <p>{enhanceContent(children, collectionSlug)}</p>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <p>{message.content}</p>
              )}
            </div>
          </article>
        ))}

        {streamingThought && (
          <article className="chat-line assistant is-thinking">
            <div className="chat-line-content">
              <div className="thinking-indicator">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-label">Thinking...</span>
              </div>
              <div className="thinking-text">
                {streamingThought}
              </div>
            </div>
          </article>
        )}
 
        {streamingText && (
          <article className="chat-line assistant is-streaming">
            <div className="chat-line-content">
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p>{enhanceContent(children, collectionSlug)}</p>
                  ),
                }}
              >
                {streamingText.trimStart()}
              </ReactMarkdown>
              <span className="narrative-cursor" />
            </div>
          </article>
        )}
      </div>

      {(researchLogs.length > 0 || phase === "researching") && (
        <details className="narrative-chat-logs" open={showLogs} onToggle={(e) => setShowLogs((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Research Activity ({researchLogs.length})</summary>
          <div className="narrative-research-logs">
            {researchLogs.length > 0 ? researchLogs.map((log) => (
              <div key={log.id} className={`narrative-log-item ${log.status}`}>
                <div className="narrative-log-row">
                  <span className="narrative-log-status">
                    {log.status === "running" ? "⏳" : log.status === "done" ? "✅" : log.status === "partial" ? "⚠️" : "❌"}
                  </span>
                  <span className="narrative-log-tool">{log.tool.replace("_", " ")}</span>
                  <span className="narrative-log-args">{String(log.args.query || log.args.question || log.args.keyword || JSON.stringify(log.args))}</span>
                </div>
              </div>
            )) : (
              <div className="narrative-log-item running">
                <div className="narrative-log-row">
                  <span className="narrative-log-status">🤔</span>
                  <span className="narrative-log-tool">Researcher</span>
                  <span className="narrative-log-args">Evaluating collection context...</span>
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {(error || inputError || localInputError) && (
        <p className="narrative-chat-error" role="status" aria-live="polite">
          {error ?? inputError ?? localInputError}
        </p>
      )}
      {!error && !inputError && !localInputError && wikiStatusError && (
        <p className="narrative-chat-error" role="status" aria-live="polite">
          {wikiStatusError}
        </p>
      )}

      <form className="narrative-chat-input" onSubmit={submit}>
        <textarea
          className="input-field"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value)
            setLocalInputError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            if (event.nativeEvent.isComposing) return
            if (event.ctrlKey) return

            event.preventDefault()
            void sendCurrentPrompt()
          }}
          placeholder={hasKey ? "Ask about this inscription's history, provenance, transfers, or collection context..." : "Configure BYOK to start chatting"}
          disabled={!hasKey || isLoading}
          rows={3}
          aria-invalid={Boolean(inputError || localInputError)}
        />
        <div className="narrative-chat-footer">
          <div className="narrative-chat-meta">
            {providerName && modelName && <span className="model-badge">{providerName} · {modelName}</span>}
            {inputMode === "image+context" && <span>image + context</span>}
            {wikiStatusLabel && <span>{wikiStatusLabel}</span>}
            {elapsed >= 10 && <span>{elapsed}s</span>}
          </div>
          <div className="narrative-chat-actions">
            {!hasKey ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={onOpenBYOK}>
                🔑 Configure BYOK
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-sm narrative-icon-btn"
                  onClick={onNewThread}
                  disabled={isLoading}
                  aria-label="Start a new chat session"
                  title="New session"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn btn-sm narrative-icon-btn"
                  onClick={() => setShowHistory(true)}
                  aria-label="Open chat history"
                  title="History"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                {error && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onRetry()}>
                    Retry
                  </button>
                )}
                {isLoading ? (
                  <button
                    type="button"
                    className="btn btn-sm narrative-icon-btn narrative-stop-btn"
                    onClick={onCancel}
                    aria-label="Stop generation"
                    title="Stop"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="2" ry="2" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="btn btn-sm narrative-icon-btn narrative-send-btn"
                    aria-label="Send message"
                    title="Send"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 12h13" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

function enhanceContent(children: React.ReactNode, collectionSlug?: string): React.ReactNode {
  if (typeof children !== "string") return children
  return linkifyBrands(children, collectionSlug)
}
