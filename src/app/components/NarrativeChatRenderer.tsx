import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { motion, AnimatePresence } from "motion/react"
import { formatChronicleText } from "../lib/formatters"
import { MODELS } from "../lib/byok"
import type { ChatMessage, ChatThreadSummary } from "../lib/byok/chatTypes"
import type { ResearchLog } from "../lib/byok/toolExecutor"
import type { SynthesisMode } from "../lib/byok/context"
import type { SynthesisPhase } from "../lib/byok/useChronicleNarrativeChat"
import type { WikiActivityStatus } from "../lib/byok/useChronicleNarrativeChat"
import { ChatHistoryModal } from "./ChatHistoryModal"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"

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
  modelId?: string
  onModelChange?: (modelId: string) => void
  inputMode?: SynthesisMode | null
  wikiStatusLabel?: string
  wikiStatusError?: string | null
  wikiActivity?: WikiActivityStatus | null
  error?: string | null
  inputError?: string | null
  researchLogs?: ResearchLog[]
  hasKey: boolean
  collectionSlug?: string
  onSend: (prompt: string) => Promise<void> | void
  onEdit: (messageId: string, content: string) => Promise<void> | void
  onNewThread: () => void
  onResumeThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => boolean
  onDeleteThread: (threadId: string) => boolean
  onRetry: () => Promise<void> | void
  onCancel: () => void
  onOpenBYOK: () => void
  onOpenWikiGraph?: () => void
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
  modelId,
  onModelChange,
  inputMode,
  wikiStatusError,
  wikiActivity,
  error,
  inputError,
  researchLogs = [],
  hasKey,
  collectionSlug,
  onSend,
  onEdit,
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
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [localInputError, setLocalInputError] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState("")
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const { identity } = useDiscordIdentity()

  const isLoading = phase !== "idle" && phase !== "done" && phase !== "error"
  const transcript = useMemo(() => messages, [messages])

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, streamingText, streamingThought, isLoading])

  useEffect(() => {
    if (!editingMessageId) return
    const timer = setTimeout(() => {
      const el = document.getElementById(`chat-msg-${editingMessageId}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [editingMessageId])

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
              <button className="btn-premium" onClick={onOpenBYOK}>
                <span className="byok-icon icon-premium">🔑</span>
                <span>Configure BYOK</span>
              </button>
            )}
          </div>
        )}

        {transcript.map((message) => (
          <article 
            key={message.id} 
            id={`chat-msg-${message.id}`}
            className={`chat-line ${message.role === "assistant" ? "assistant" : "user"}`}
          >
            <div className="chat-line-content">
              {message.role === "assistant" ? (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => (
                      <p>{formatChronicleText(children, collectionSlug)}</p>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <div className="chat-user-message-container">
                  {identity && (
                    <div className="chat-user-meta" style={{ marginBottom: "0.25rem", textAlign: "right" }}>
                      <span className={`wiki-tier-badge tier-${identity.tier}`} style={{ fontSize: "0.65rem", padding: "2px 6px" }}>
                        {identity.tier}
                      </span>
                    </div>
                  )}
                  {editingMessageId === message.id ? (
                    <div className="chat-edit-well">
                      <textarea
                        className="input-field edit-textarea"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                      <div className="chat-edit-actions">
                        <button 
                          className="btn btn-sm btn-ghost" 
                          onClick={() => setEditingMessageId(null)}
                        >
                          Cancel
                        </button>
                        <button 
                          className="btn btn-sm btn-primary" 
                          onClick={async () => {
                            const next = editingContent.trim()
                            if (!next) return
                            setEditingMessageId(null)
                            await onEdit(message.id, next)
                          }}
                        >
                          Save & Submit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              )}
            </div>
            {message.role === "user" && editingMessageId !== message.id && (
              <div className="chat-line-actions">
                <button 
                  className="chat-edit-trigger"
                  onClick={() => {
                    setEditingMessageId(message.id)
                    setEditingContent(message.content)
                  }}
                  title="Edit message"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  <span>Edit</span>
                </button>
              </div>
            )}
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

        {isLoading && !streamingThought && !streamingText && (
          <article className="chat-line assistant is-loading-skeleton">
            <div className="chat-line-content">
              <div className="skeleton-loader">
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
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
                    <p>{formatChronicleText(children, collectionSlug)}</p>
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

      {(researchLogs.length > 0 || phase === "researching" || wikiActivity) && (
        <details className="narrative-chat-logs" open={showLogs} onToggle={(e) => setShowLogs((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Activity ({researchLogs.length + (wikiActivity ? 1 : 0)})</summary>
          <div className="narrative-research-logs">
            {wikiActivity && (
              <div className={`narrative-log-item wiki-activity state-${wikiActivity.state}`}>
                <div className="narrative-log-row">
                  <span className="narrative-log-status">
                    <span className="narrative-chat-status-dot" aria-hidden="true" />
                  </span>
                  <span className="narrative-log-tool">Portal</span>
                  <span className="narrative-log-args">{wikiActivity.label}</span>
                </div>
              </div>
            )}
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
            )) : !wikiActivity && (
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
            {modelName && (
              <div className="model-badge-container">
                <AnimatePresence>
                  {showModelSelector && providerName && (
                    <motion.div
                      className="model-selector-menu glass-card"
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      <div className="model-selector-header">Switch Model</div>
                      <div className="model-selector-list">
                        {MODELS[providerName]?.map((m) => (
                          <button
                            key={m.id}
                            className={`model-selector-item ${m.id === modelId ? "active" : ""}`}
                            onClick={() => {
                              onModelChange?.(m.id)
                              setShowModelSelector(false)
                            }}
                          >
                            <span className="model-item-name">{m.name}</span>
                            {m.id === modelId && (
                              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="3" fill="none">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  className="model-badge"
                  title={`Current: ${modelName}. Click to change model.`}
                  onClick={() => setShowModelSelector(!showModelSelector)}
                >
                  {modelName}
                  <svg 
                    width="8" 
                    height="8" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="3" 
                    style={{ 
                      marginLeft: "4px", 
                      opacity: 0.6,
                      transform: showModelSelector ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease"
                    }}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
            )}
            {inputMode && inputMode !== "text-only" && <span>attachments + context</span>}
            {elapsed >= 10 && <span>{elapsed}s</span>}
          </div>
          <div className="narrative-chat-actions">
            {!hasKey ? (
              <button type="button" className="btn-premium" onClick={onOpenBYOK}>
                <span className="byok-icon icon-premium">🔑</span>
                <span>Configure BYOK</span>
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
                    className="btn btn-sm narrative-icon-btn narrative-stop-btn is-processing"
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
