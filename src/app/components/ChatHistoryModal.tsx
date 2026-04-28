import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import type { ChatThreadSummary } from "../lib/byok/chatTypes"

interface Props {
  open: boolean
  activeThreadId: string | null
  threads: ChatThreadSummary[]
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => boolean
  onDeleteThread: (threadId: string) => boolean
  onClose: () => void
}

export function ChatHistoryModal({
  open,
  activeThreadId,
  threads,
  onSelectThread,
  onRenameThread,
  onDeleteThread,
  onClose,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState("")
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const root = dialogRef.current
        if (!root) return
        const focusables = root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null

        if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    closeButtonRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) return

    const timeoutId = window.setTimeout(() => {
      setEditingThreadId(null)
      setEditingValue("")
      setPendingDeleteThreadId(null)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [open])

  const sortedThreads = useMemo(
    () => threads.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [threads]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="chat-history-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={dialogRef}
            className="chat-history-modal glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-history-title"
            aria-describedby="chat-history-description"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <header className="chat-history-header">
              <div>
                <h2 id="chat-history-title">Chat History</h2>
                <p id="chat-history-description">
                  Resume any previous session for this inscription.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onClose}
                aria-label="Close history modal"
              >
                Close
              </button>
            </header>

            <div className="chat-history-list" role="list">
              {sortedThreads.length === 0 && (
                <div className="chat-history-empty">No previous sessions yet.</div>
              )}

              {sortedThreads.map((thread) => {
                const isActive = thread.threadId === activeThreadId
                const isEditing = editingThreadId === thread.threadId
                const isPendingDelete = pendingDeleteThreadId === thread.threadId
                return (
                  <div
                    key={thread.threadId}
                    className={`chat-history-item ${isActive ? "active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onSelectThread(thread.threadId)
                      onClose()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelectThread(thread.threadId)
                        onClose()
                      }
                    }}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <div className="chat-history-item-top">
                      {isEditing ? (
                        <input
                          className="chat-history-rename-input"
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              event.stopPropagation()
                              const ok = onRenameThread(thread.threadId, editingValue)
                              if (ok) {
                                setEditingThreadId(null)
                                setEditingValue("")
                              }
                            }
                            if (event.key === "Escape") {
                              event.preventDefault()
                              event.stopPropagation()
                              setEditingThreadId(null)
                              setEditingValue("")
                            }
                          }}
                          aria-label="Rename session title"
                          maxLength={120}
                          autoFocus
                        />
                      ) : (
                        <span className="chat-history-item-title">{thread.title || "Untitled session"}</span>
                      )}
                      <span className="chat-history-item-date">
                        {formatDate(thread.updatedAt)}
                      </span>
                    </div>
                    <div className="chat-history-item-meta">
                      <span>{thread.messageCount} messages</span>
                      <span className="chat-history-item-preview">{thread.preview}</span>
                    </div>
                    <div className="chat-history-item-actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="chat-history-action-btn save"
                            onClick={(event) => {
                              event.stopPropagation()
                              const ok = onRenameThread(thread.threadId, editingValue)
                              if (ok) {
                                setEditingThreadId(null)
                                setEditingValue("")
                              }
                            }}
                            aria-label="Save session name"
                            title="Save"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m5 12 4 4 10-10" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="chat-history-action-btn"
                            onClick={(event) => {
                              event.stopPropagation()
                              setEditingThreadId(null)
                              setEditingValue("")
                            }}
                            aria-label="Cancel rename"
                            title="Cancel"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m18 6-12 12" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="chat-history-action-btn"
                            onClick={(event) => {
                              event.stopPropagation()
                              setPendingDeleteThreadId(null)
                              setEditingThreadId(thread.threadId)
                              setEditingValue(thread.title || "")
                            }}
                            aria-label="Rename session"
                            title="Rename"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 21h6" />
                              <path d="M14.7 4.3a1 1 0 0 1 1.4 0l3.6 3.6a1 1 0 0 1 0 1.4L8 21H4v-4z" />
                            </svg>
                          </button>
                          {isPendingDelete ? (
                            <>
                              <button
                                type="button"
                                className="chat-history-action-btn delete"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  const deleted = onDeleteThread(thread.threadId)
                                  if (deleted) {
                                    setPendingDeleteThreadId(null)
                                  }
                                }}
                                aria-label="Confirm delete session"
                                title="Confirm delete"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m5 12 4 4 10-10" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="chat-history-action-btn"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setPendingDeleteThreadId(null)
                                }}
                                aria-label="Cancel delete session"
                                title="Cancel delete"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="m18 6-12 12" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="chat-history-action-btn delete"
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditingThreadId(null)
                                setEditingValue("")
                                setPendingDeleteThreadId(thread.threadId)
                              }}
                              aria-label="Delete session"
                              title="Delete"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
