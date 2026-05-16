import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import type { CanonicalField } from "../lib/byok/wikiCompleteness"
import type { PublicAuthorMode } from "../lib/types"
import { WikiPublicAuthorAvatar } from "./WikiPublicAuthorAvatar"
import "../styles/features/wiki/wiki.css"

export function buildWikiContributionSessionId(slug: string, field: CanonicalField): string {
  return `wiki-page:${slug}:${field}`
}

export function resolveContributionStatusMessage(status: string | undefined): string {
  if (status === "duplicate") {
    return "This draft already matches the latest contribution for this field."
  }
  if (status === "quarantine") {
    return "Your contribution was saved for moderator review."
  }
  return "Your contribution was published to Drafts."
}

interface SubmitResult {
  ok: boolean
  message: string
}

interface IdentityPreview {
  username: string
  avatar: string | null
}

interface Props {
  open: boolean
  slug: string
  field: CanonicalField | null
  initialValue?: string
  title?: string
  description?: string
  submitLabel?: string
  identityTier?: string | null
  identityPreview?: IdentityPreview | null
  onClose: () => void
  onSubmit: (value: string, publicAuthorMode: PublicAuthorMode) => Promise<SubmitResult>
}

export function WikiContributionModal({
  open,
  slug,
  field,
  initialValue = "",
  title,
  description,
  submitLabel = "Publish Draft",
  identityTier,
  identityPreview,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [publicAuthorMode, setPublicAuthorMode] = useState<PublicAuthorMode>("anonymous")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const submitShortcutLabel = typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "Cmd" : "Ctrl"

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setPublicAuthorMode("anonymous")
    setError(null)
    setSuccess(null)
    setIsSubmitting(false)
  }, [open, initialValue, field, slug])

  useEffect(() => {
    if (!open || !field) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        event.preventDefault()
        onClose()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        void handleSubmit()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    textareaRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, field, isSubmitting, onClose])

  async function handleSubmit(): Promise<void> {
    if (!field) return
    const nextValue = value.trim()
    if (!nextValue) {
      setError("Write a concise contribution before submitting.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await onSubmit(nextValue, publicAuthorMode)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSuccess(result.message)
      window.setTimeout(() => {
        onClose()
      }, 900)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!field) return null

  const fieldLabel = formatFieldName(field)
  const modalTitle = title ?? `Fill ${fieldLabel}`
  const modalDescription = description ?? "Add factual context for this missing field. Your contribution will appear in Drafts first and higher tiers can later confirm it into consensus."

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="byok-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) {
              onClose()
            }
          }}
        >
          <motion.div
            className="byok-modal glass-card wiki-contribution-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiki-contribution-title"
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            transition={{ duration: 0.18 }}
          >
            <button
              type="button"
              className="btn-close-minimal modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
              disabled={isSubmitting}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            <div className="wiki-contribution-modal-copy">
              <span className="wiki-contribution-kicker">Draft Contribution</span>
              <h2 id="wiki-contribution-title">{modalTitle}</h2>
              <p>{modalDescription}</p>
            </div>

            <div className="wiki-contribution-meta">
              <span className={`wiki-tier-badge tier-${identityTier ?? "community"}`}>{identityTier ?? "community"}</span>
              <span className="wiki-contribution-chip">{slug}</span>
            </div>

            <div className="wiki-contribution-form">
              <div className="wiki-contribution-visibility" role="group" aria-label="Contribution author visibility">
                <span className="wiki-contribution-visibility-label">Public attribution</span>
                <div className="wiki-contribution-visibility-options">
                  <button
                    type="button"
                    className={`wiki-contribution-visibility-option ${publicAuthorMode === "anonymous" ? "is-active" : ""}`}
                    onClick={() => setPublicAuthorMode("anonymous")}
                    disabled={isSubmitting}
                  >
                    <span className="wiki-contribution-visibility-title">Anonymous</span>
                    <span className="wiki-contribution-visibility-copy">The public draft stays anonymous. Reviewers can still verify who wrote it internally.</span>
                  </button>

                  <button
                    type="button"
                    className={`wiki-contribution-visibility-option ${publicAuthorMode === "public" ? "is-active" : ""}`}
                    onClick={() => setPublicAuthorMode("public")}
                    disabled={isSubmitting}
                  >
                    <span className="wiki-contribution-visibility-title">Show me as author</span>
                    <span className="wiki-contribution-visibility-copy">Attach your current Discord profile to this public contribution.</span>
                    {publicAuthorMode === "public" && identityPreview && (
                      <span className="wiki-contribution-visibility-preview">
                        <WikiPublicAuthorAvatar
                          author={{ mode: "public", username: identityPreview.username, avatar_url: identityPreview.avatar }}
                          size="sm"
                          label="Visible author"
                        />
                        <span className="wiki-contribution-visibility-username">{identityPreview.username}</span>
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                className="input-field wiki-contribution-textarea"
                placeholder={`Describe ${fieldLabel.toLowerCase()} with concise, source-minded detail...`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={isSubmitting}
                maxLength={2000}
              />

              <div className="wiki-contribution-footer">
                <span className="wiki-contribution-hint">
                  Keep it factual. Press {submitShortcutLabel}+Enter to submit.
                </span>
                <span className="wiki-contribution-count">{value.trim().length}/2000</span>
              </div>

              {error && (
                <p className="wiki-contribution-message is-error">{error}</p>
              )}
              {success && (
                <p className="wiki-contribution-message is-success">{success}</p>
              )}

              <div className="byok-actions wiki-contribution-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting || !value.trim()}
                >
                  {isSubmitting ? "Saving..." : submitLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function formatFieldName(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
