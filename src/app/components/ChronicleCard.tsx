import { useState, useEffect } from "react"
import { KeyStore } from "../lib/byok"
import { SatBadge } from "./SatBadge"
import type { ChronicleResponse } from "../lib/types"
import ReactMarkdown from "react-markdown"

interface Props {
  chronicle: ChronicleResponse
  narrative: string | null
  synthLoading: boolean
  synthError: string | null
  onSynthesize: () => void
}

export function ChronicleCard({
  chronicle,
  narrative,
  synthLoading,
  synthError,
  onSynthesize,
}: Props) {
  const { meta, events } = chronicle
  const hasKey = KeyStore.has()
  const [loadingStep, setLoadingStep] = useState(0)

  useEffect(() => {
    if (!synthLoading) {
      setLoadingStep(0)
      return
    }

    const steps = [
      { delay: 1200, step: 1 },
      { delay: 2800, step: 2 },
      { delay: 4500, step: 3 },
    ]

    const timeouts = steps.map(({ delay, step }) =>
      setTimeout(() => setLoadingStep(step), delay)
    )

    return () => timeouts.forEach(clearTimeout)
  }, [synthLoading])

  const loadingMessages = [
    "Connecting to provider...",
    "Analyzing on-chain data...",
    "Evaluating historical events...",
    "Synthesizing Chronicle..."
  ]

  function handleShare() {
    const text = `Inscription #${meta.inscription_number} — ${events.length} events in its Chronicle. Explore on Ordinal Mind.`
    const url = window.location.href

    if (navigator.share) {
      navigator.share({ title: "Ordinal Mind Chronicle", text, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {})
    }
  }

  return (
    <div className="chronicle-card glass-card">
      {/* Left side: Image, Title, Meta, Actions */}
      <div className="chronicle-card-left">
        <div className="chronicle-card-content-preview">
          <img
            src={meta.content_url}
            alt={`Inscription #${meta.inscription_number}`}
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = "none"
            }}
          />
        </div>

        {/* Title */}
        <h2 className="chronicle-card-title">
          Inscription #{meta.inscription_number}
        </h2>

        {/* Meta badges */}
        <div className="chronicle-card-meta">
          <SatBadge rarity={meta.sat_rarity} />
          <span className="sat-badge sat-badge--common">
            {meta.content_type.split("/")[1] ?? meta.content_type}
          </span>
          <span className="sat-badge sat-badge--common">
            {events.length} events
          </span>
        </div>

        {/* Actions */}
        <div className="chronicle-card-actions">
          {!narrative && (
            <button
              className="btn btn-primary"
              onClick={onSynthesize}
              disabled={synthLoading || !hasKey}
              id="synthesize-btn"
            >
              {synthLoading
                ? "Generating..."
                : hasKey
                  ? "✨ Generate Narrative"
                  : "🔑 Set Key First"}
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleShare}
            id="share-btn"
          >
            Share
          </button>
        </div>
      </div>

      {/* Right side: Data and Narrative */}
      <div className="chronicle-card-right">
        {/* Narrative (if generated) */}
        {narrative && !synthLoading && (
          <div className="chronicle-card-narrative">
            <ReactMarkdown>{narrative}</ReactMarkdown>
          </div>
        )}

        {/* Loading State */}
        {synthLoading && (
          <div className="chronicle-card-narrative loading-narrative">
            <div className="loading-steps">
              <span className="loading-spinner"></span>
              {loadingMessages[loadingStep]}
            </div>
            <div className="skeleton skeleton-text" style={{ width: "100%" }}></div>
            <div className="skeleton skeleton-text" style={{ width: "90%" }}></div>
            <div className="skeleton skeleton-text" style={{ width: "95%" }}></div>
            <div className="skeleton skeleton-text" style={{ width: "60%" }}></div>
          </div>
        )}

        {synthError && (
          <p className="home-error" style={{ marginBottom: "1rem" }}>
            {synthError}
          </p>
        )}
      </div>
    </div>
  )
}
