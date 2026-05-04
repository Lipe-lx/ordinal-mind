import { useEffect, useMemo, useRef } from "react"
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

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
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
  }, [open, onClose])

  const sortedItems = useMemo(
    () => items.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [items]
  )

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

              {sortedItems.map((item) => {
                const isActing = actingId === item.id
                return (
                  <article key={item.id} className="wiki-review-card" role="listitem">
                    <div className="wiki-review-card-top">
                      <div>
                        <div className="wiki-review-field-row">
                          <span className="wiki-review-field">{formatFieldName(item.field)}</span>
                          <span className="wiki-review-slug">{item.collection_slug}</span>
                        </div>
                        <p className="wiki-review-summary">{buildContributionSummary(item)}</p>
                      </div>
                      <span className="wiki-review-age">{formatRelativeTimestamp(item.created_at)}</span>
                    </div>

                    <div className="wiki-review-badges">
                      <span className={`wiki-tier-badge tier-${item.contributor_tier}`}>{item.contributor_tier}</span>
                      <span className="wiki-review-badge">{contributorLabel(item)}</span>
                      <span className="wiki-review-badge">{item.confidence}</span>
                      <span className={`wiki-review-badge ${item.verifiable ? "is-verifiable" : "is-unverified"}`}>
                        {item.verifiable ? "publicly verifiable" : "community claim"}
                      </span>
                    </div>

                    <div className="wiki-review-diff">
                      <div className="wiki-review-panel">
                        <span className="wiki-review-panel-label">Current wiki</span>
                        <p>{item.current_value || "No published value yet."}</p>
                        {item.current_tier && <span className={`wiki-tier-badge tier-${item.current_tier}`}>{item.current_tier}</span>}
                      </div>
                      <div className="wiki-review-panel is-proposed">
                        <span className="wiki-review-panel-label">Proposed update</span>
                        <p>{item.proposed_value}</p>
                      </div>
                    </div>

                    {item.source_excerpt && (
                      <div className="wiki-review-excerpt">
                        <span className="wiki-review-panel-label">Chat excerpt</span>
                        <p>{item.source_excerpt}</p>
                      </div>
                    )}

                    <div className="wiki-review-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onReject(item.id)}
                        disabled={isActing}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void onApprove(item.id)}
                        disabled={isActing}
                      >
                        {isActing ? "Saving..." : "Approve"}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
