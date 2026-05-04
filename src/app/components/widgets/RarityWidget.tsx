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
  const CELLS_PER_PAGE = 6

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

  const gridCells = useMemo(() => {
    const cells: Array<
      | { kind: "rank"; rank: number; supply: number | null; percentile: number | null }
      | { kind: "trait"; trait: TraitRarityBreakdown }
    > = []

    if (rarity?.rarity_rank != null) {
      cells.push({
        kind: "rank",
        rank: rarity.rarity_rank,
        supply: rarity.total_supply,
        percentile: rarity.rarity_percentile,
      })
    }

    for (const trait of traitItems) {
      cells.push({ kind: "trait", trait })
    }

    return cells
  }, [rarity?.rarity_percentile, rarity?.rarity_rank, rarity?.total_supply, traitItems])

  const totalPages = Math.max(1, Math.ceil(gridCells.length / CELLS_PER_PAGE))


  const visibleCells = useMemo(() => {
    const start = currentPage * CELLS_PER_PAGE
    return gridCells.slice(start, start + CELLS_PER_PAGE)
  }, [currentPage, gridCells])

  const cellSlots = useMemo(() => {
    const slots: Array<(typeof visibleCells)[number] | null> = [...visibleCells]
    while (slots.length < CELLS_PER_PAGE) {
      slots.push(null)
    }
    return slots
  }, [visibleCells])

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

      <div className="widget-meta-grid widget-rarity-traits-grid">
        {cellSlots.map((cell, index) => {
          const isPlaceholder = !cell && index === 0 && gridCells.length === 0
          return (
            <div
              key={
                cell?.kind === "rank"
                  ? `rank-${currentPage}`
                  : cell?.kind === "trait"
                    ? `${cell.trait.trait_type}-${cell.trait.value}`
                    : `empty-${currentPage}-${index}`
              }
              className={`widget-meta-cell ${cell || isPlaceholder ? "" : "widget-meta-cell-empty"}`.trim()}
              aria-hidden={!cell && !isPlaceholder}
            >
              {cell?.kind === "rank" ? (
                <>
                  <span className="widget-meta-label">Rarity Rank</span>
                  <span className="widget-meta-value">#{cell.rank.toLocaleString("en-US")}</span>
                  <div className="widget-rarity-trait-stats">
                    <span className="widget-meta-sub">
                      of {cell.supply?.toLocaleString("en-US") ?? "—"}
                    </span>
                    {cell.percentile != null && (
                      <span className="widget-meta-sub">
                        top {formatTraitFrequencyPct(cell.percentile)}
                      </span>
                    )}
                  </div>
                </>
              ) : cell?.kind === "trait" ? (
                <>
                  <span className="widget-meta-label">{cell.trait.trait_type}</span>
                  <span className="widget-meta-value">{cell.trait.value}</span>
                  {(cell.trait.frequency !== undefined || cell.trait.frequency_pct !== undefined) && (
                    <div className="widget-rarity-trait-stats">
                      {cell.trait.frequency !== undefined && (
                        <span className="widget-meta-sub">
                          {cell.trait.frequency.toLocaleString("en-US")} items
                        </span>
                      )}
                      {cell.trait.frequency_pct !== undefined && (
                        <span className="widget-meta-sub">
                          {formatTraitFrequencyPct(cell.trait.frequency_pct)}
                        </span>
                      )}
                    </div>
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

function formatTraitFrequencyPct(value: number): string {
  if (value < 1) return `${value.toFixed(2)}%`
  if (value < 10) return `${value.toFixed(2)}%`
  if (value < 100) return `${value.toFixed(1)}%`
  return `${Math.round(value)}%`
}
