// Rarity & Traits Widget — displays trait-based rarity data from UniSat.
// Shows: rank headline, trait breakdown with frequency bars, data confidence indicator.
// Refactored to match InscriptionMetaWidget grid style.

import type { UnisatEnrichment, DataValidationResult } from "../../lib/types"

interface Props {
  unisatEnrichment?: UnisatEnrichment
  validation?: DataValidationResult
}

export function RarityWidget({ unisatEnrichment, validation }: Props) {
  const rarity = unisatEnrichment?.rarity
  if (!rarity || rarity.traits.length === 0) return null

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
      <div className="widget-rarity-grid-label">Traits & Attributes</div>
      
      <div className="widget-meta-grid">
        {/* Rank Cell */}
        {rarity.rarity_rank && (
          <div className="widget-meta-cell">
            <span className="widget-meta-label">Rarity Rank</span>
            <span className="widget-meta-value">#{rarity.rarity_rank.toLocaleString("en-US")}</span>
            <span className="widget-meta-sub">
              of {rarity.total_supply?.toLocaleString("en-US") ?? "—"} {rarity.rarity_percentile ? `· top ${rarity.rarity_percentile}%` : ""}
            </span>
          </div>
        )}

        {/* Traits */}
        {rarity.trait_breakdown.map((trait) => (
          <div key={`${trait.trait_type}-${trait.value}`} className="widget-meta-cell">
            <span className="widget-meta-label">{trait.trait_type}</span>
            <span className="widget-meta-value">{trait.value}</span>
            {trait.frequency_pct !== undefined && (
              <span className="widget-meta-sub">
                {trait.frequency_pct < 1
                  ? `${trait.frequency_pct.toFixed(2)}%`
                  : `${Math.round(trait.frequency_pct)}%`} freq
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Footer Info (Validation & Source) */}
      <div className="widget-rarity-grid-footer">
        {validation && (
          <div className={`widget-rarity-confidence-mini tone-${validation.confidence}`}>
            {confidenceIcon} {confidenceLabel} · {agreeing}/{total}
          </div>
        )}
        <div className="widget-rarity-source-mini">
          via {rarity.rarity_rank ? "Satflow & ord.net" : "ord.net"}
        </div>
      </div>
    </div>
  )
}
