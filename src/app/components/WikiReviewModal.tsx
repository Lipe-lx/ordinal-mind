import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import type { WikiReviewItem } from "../lib/useWikiReviewQueue"

interface Props {
  open: boolean
  items: WikiReviewItem[]
  loading: boolean
  error: string | null
  actingId: string | null
  onApprove: (reviewId: string) => Promise<void> | void
  onReject: (reviewId: string) => Promise<void> | void
  onRefresh: () => Promise<void> | void
  onClose: () => void
}

function formatFieldName(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
}

function formatRelativeTimestamp(value: string): string {
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return "Just now"

  const diffMs = Date.now() - then
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000))
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}

function buildContributionSummary(item: WikiReviewItem): string {
  return item.current_value
    ? "Model captured a proposed wiki update."
    : "Model captured a new wiki field suggestion."
}

function contributorLabel(item: WikiReviewItem): string {
  return item.contributor_username || item.contributor_id || "Anonymous contributor"
}

export function WikiReviewModal({
  open,
  items,
  loading,
  error,
  actingId,
  onApprove,
  onReject,
  onRefresh,
  onClose,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const sortedItems = useMemo(
    () => items.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [items]
  )

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setActiveIndex((prev) => Math.max(0, prev - 1))
        return
      }

      if (event.key === "ArrowRight") {
        event.preventDefault()
        setActiveIndex((prev) => Math.min(sortedItems.length - 1, prev + 1))
        return
      }

      if (event.key !== "Tab") return
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
    }

    window.addEventListener("keydown", onKeyDown)
    closeButtonRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose, sortedItems.length])

  useEffect(() => {
    if (!open) return
    setActiveIndex((prev) => {
      if (sortedItems.length === 0) return 0
      return Math.min(prev, sortedItems.length - 1)
    })
  }, [open, sortedItems.length])

  const activeItem = sortedItems[activeIndex] ?? null
  const canGoPrev = activeIndex > 0
  const canGoNext = activeIndex < sortedItems.length - 1

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="wiki-review-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={dialogRef}
            className="wiki-review-modal glass-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiki-review-title"
            aria-describedby="wiki-review-description"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <header className="wiki-review-header">
              <div>
                <h2 id="wiki-review-title">Genesis Review Inbox</h2>
                <p id="wiki-review-description">
                  Review what the model wants to update in the collection wiki before it becomes canonical.
                </p>
              </div>
              <div className="wiki-review-header-actions">
                {sortedItems.length > 1 && (
                  <div className="wiki-review-nav" aria-label="Review navigation">
                    <button
                      type="button"
                      className="wiki-review-nav-btn"
                      onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                      disabled={!canGoPrev}
                      aria-label="Previous review"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <span className="wiki-review-nav-count">
                      {activeIndex + 1} / {sortedItems.length}
                    </span>
                    <button
                      type="button"
                      className="wiki-review-nav-btn"
                      onClick={() => setActiveIndex((prev) => Math.min(sortedItems.length - 1, prev + 1))}
                      disabled={!canGoNext}
                      aria-label="Next review"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onRefresh()}>
                  Refresh
                </button>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onClose}
                  aria-label="Close review inbox"
                >
                  Close
                </button>
              </div>
            </header>

            {error && <p className="wiki-review-error">{error}</p>}

            <div className="wiki-review-list" role="list">
              {loading && sortedItems.length === 0 && (
                <div className="wiki-review-empty">Loading pending reviews...</div>
              )}

              {!loading && sortedItems.length === 0 && (
                <div className="wiki-review-empty">No pending Genesis reviews right now.</div>
              )}

              {activeItem && (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.article
                    key={activeItem.id}
                    className="wiki-review-card"
                    role="listitem"
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -18 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div className="wiki-review-card-top">
                      <div>
                        <div className="wiki-review-field-row">
                          <span className="wiki-review-field">{formatFieldName(activeItem.field)}</span>
                          <span className="wiki-review-slug">{activeItem.collection_slug}</span>
                        </div>
                        <p className="wiki-review-summary">{buildContributionSummary(activeItem)}</p>
                      </div>
                      <span className="wiki-review-age">{formatRelativeTimestamp(activeItem.created_at)}</span>
                    </div>

                    <div className="wiki-review-badges">
                      <span className={`wiki-tier-badge tier-${activeItem.contributor_tier}`}>{activeItem.contributor_tier}</span>
                      <span className="wiki-review-badge">{contributorLabel(activeItem)}</span>
                      <span className="wiki-review-badge">{activeItem.confidence}</span>
                      <span className={`wiki-review-badge ${activeItem.verifiable ? "is-verifiable" : "is-unverified"}`}>
                        {activeItem.verifiable ? "publicly verifiable" : "community claim"}
                      </span>
                    </div>

                    <div className="wiki-review-diff">
                      <div className="wiki-review-panel">
                        <span className="wiki-review-panel-label">Current wiki</span>
                        <p>{activeItem.current_value || "No published value yet."}</p>
                        {activeItem.current_tier && <span className={`wiki-tier-badge tier-${activeItem.current_tier}`}>{activeItem.current_tier}</span>}
                      </div>
                      <div className="wiki-review-panel is-proposed">
                        <span className="wiki-review-panel-label">Proposed update</span>
                        <p>{activeItem.proposed_value}</p>
                      </div>
                    </div>

                    {activeItem.source_excerpt && (
                      <div className="wiki-review-excerpt">
                        <span className="wiki-review-panel-label">Chat excerpt</span>
                        <p>{activeItem.source_excerpt}</p>
                      </div>
                    )}

                    <div className="wiki-review-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onReject(activeItem.id)}
                        disabled={actingId === activeItem.id}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void onApprove(activeItem.id)}
                        disabled={actingId === activeItem.id}
                      >
                        {actingId === activeItem.id ? "Saving..." : "Approve"}
                      </button>
                    </div>
                  </motion.article>
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
