// Rarity & Traits Widget — displays trait-based rarity data from the merged factual pipeline.
// Shows: rank headline, trait breakdown with frequency bars, data confidence indicator.
// Refactored to match InscriptionMetaWidget grid style.

import { useMemo, useState } from "react"
import type { UnisatEnrichment, DataValidationResult, TraitRarityBreakdown } from "../../lib/types"

interface Props {
  unisatEnrichment?: UnisatEnrichment
  validation?: DataValidationResult
}

export function RarityWidget({ unisatEnrichment, validation }: Props) {
  const [currentPage, setCurrentPage] = useState(0)

  const rarity = unisatEnrichment?.rarity
  const TRAITS_PER_PAGE = 6

  const traitItems: TraitRarityBreakdown[] = useMemo(() => {
    if (!rarity) return []
    return rarity.trait_breakdown.length > 0
      ? rarity.trait_breakdown
      : rarity.traits.map((trait) => ({
          trait_type: trait.trait_type,
          value: trait.value,
          frequency: undefined,
          frequency_pct: undefined,
          rarity_contribution: undefined,
        }))
  }, [rarity])

  const totalPages = Math.max(1, Math.ceil(traitItems.length / TRAITS_PER_PAGE))


  const visibleTraits = useMemo(() => {
    const start = currentPage * TRAITS_PER_PAGE
    return traitItems.slice(start, start + TRAITS_PER_PAGE)
  }, [currentPage, traitItems])

  const traitSlots = useMemo(() => {
    const slots: Array<(typeof visibleTraits)[number] | null> = [...visibleTraits]
    while (slots.length < TRAITS_PER_PAGE) {
      slots.push(null)
    }
    return slots
  }, [visibleTraits])

  // Removed early return guard to ensure the board always renders (fluid UI pattern)
  // if (!rarity || rarity.traits.length === 0) return null

  const confidenceIcon = validation
    ? validation.confidence === "high" ? "✓" : validation.confidence === "medium" ? "⚠" : "✗"
    : null

  const confidenceLabel = validation
    ? {
        high: "Sources corroborated",
        medium: "Partial corroboration",
        low: "Data discrepancies detected",
      }[validation.confidence]
    : null

  const agreeing = validation
    ? validation.checks.filter(c => c.sources_agree).length
    : 0
  const total = validation?.checks.length ?? 0

  return (
    <div className="widget-rarity-grid-wrapper">
      <div className="widget-rarity-grid-header">
        <div className="widget-rarity-grid-label">Traits & Attributes</div>
        {totalPages > 1 && (
          <div className="widget-rarity-pagination" aria-label="Traits pagination">
            <button
              type="button"
              className="widget-rarity-page-btn"
              aria-label="Previous traits page"
              onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
              disabled={currentPage === 0}
            >
              ←
            </button>
            <span className="widget-rarity-page-indicator">
              {currentPage + 1}/{totalPages}
            </span>
            <button
              type="button"
              className="widget-rarity-page-btn"
              aria-label="Next traits page"
              onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))}
              disabled={currentPage === totalPages - 1}
            >
              →
            </button>
          </div>
        )}
      </div>

      {!!rarity?.rarity_rank && (
        <div className="widget-meta-cell widget-rarity-rank-cell">
          <span className="widget-meta-label">Rarity Rank</span>
          <span className="widget-meta-value">#{rarity.rarity_rank.toLocaleString("en-US")}</span>
          <span className="widget-meta-sub">
            of {rarity.total_supply?.toLocaleString("en-US") ?? "—"} {rarity.rarity_percentile ? `· top ${rarity.rarity_percentile}%` : ""}
          </span>
        </div>
      )}
      
      <div className="widget-meta-grid widget-rarity-traits-grid">
        {traitSlots.map((trait, index) => {
          const isPlaceholder = !trait && index === 0 && traitItems.length === 0
          return (
            <div
              key={trait ? `${trait.trait_type}-${trait.value}` : `empty-${currentPage}-${index}`}
              className={`widget-meta-cell ${trait || isPlaceholder ? "" : "widget-meta-cell-empty"}`.trim()}
              aria-hidden={!trait && !isPlaceholder}
            >
              {trait ? (
                <>
                  <span className="widget-meta-label">{trait.trait_type}</span>
                  <span className="widget-meta-value">{trait.value}</span>
                  {trait.frequency_pct !== undefined && (
                    <span className="widget-meta-sub">
                      {trait.frequency_pct < 1
                        ? `${trait.frequency_pct.toFixed(2)}%`
                        : `${Math.round(trait.frequency_pct)}%`} freq
                    </span>
                  )}
                </>
              ) : isPlaceholder ? (
                <>
                  <span className="widget-meta-label">Attributes</span>
                  <span className="widget-meta-value" style={{ opacity: 0.5 }}>—</span>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Footer Info (Validation & Source) */}
      <div className="widget-rarity-grid-footer">
        {validation && (
          <div className={`widget-rarity-confidence-mini tone-${validation.confidence}`}>
            {confidenceIcon} {confidenceLabel} · {agreeing}/{total}
          </div>
        )}
        <div className="widget-rarity-source-mini">
          via public metadata and market overlays
        </div>
      </div>
    </div>
  )
}
