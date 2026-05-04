// Rarity Engine — merges factual on-chain CBOR traits with market overlay frequency/rank data.
// 
// Priority order for traits:
// 1. Marketplace overlays (Satflow / ord.net) — preferred because they aggregate
//    the full trait set with frequency counts. On-chain CBOR may only carry the
//    linking sat's traits, resulting in an incomplete picture.
// 2. CBOR on-chain metadata — supplementary; any unique traits not in marketplace
//    data are merged in.
// 3. Graceful degradation: if overlays have no data, CBOR traits are shown without a global rank.

import type {
  InscriptionRarity,
  TraitAttribute,
  TraitRarityBreakdown,
  MarketOverlayMatch
} from "../app/lib/types"

export function buildInscriptionRarity(
  cborTraits: Record<string, string> | null,
  marketRarity: MarketOverlayMatch["rarity_overlay"] | undefined
): InscriptionRarity | null {
  // We need at least one factual trait source to build a rarity context
  if (!cborTraits && !marketRarity?.traits) {
    return null
  }

  // Marketplace sources (satflow / ord.net) are preferred for the trait list
  // because on-chain CBOR traits may be spread across different sats with only
  // one linking sat, resulting in an incomplete trait set. Marketplace sources
  // aggregate all traits with frequency counts, making them the most reliable
  // source for the "Traits & Attributes" card.
  //
  // Any unique CBOR traits not present in the marketplace data are merged in
  // as supplementary entries.
  const finalTraits: TraitAttribute[] = []
  
  if (marketRarity?.traits && marketRarity.traits.length > 0) {
    for (const t of marketRarity.traits) {
      if (t.key.trim().toLowerCase() === "attributes") continue // skip empty container rows
      const normalized = normalizeTraitPair(t.key, t.value)
      if (normalized) finalTraits.push(normalized)
    }
  }

  // Merge unique CBOR traits that the marketplace doesn't cover
  if (cborTraits) {
    const existingKeys = new Set(
      finalTraits.map(t => `${t.trait_type.toLowerCase()}\0${t.value.toLowerCase()}`)
    )
    for (const [key, value] of Object.entries(cborTraits)) {
      const normalized = normalizeTraitPair(key, value)
      if (!normalized) continue
      const dedupeKey = `${normalized.trait_type.toLowerCase()}\0${normalized.value.toLowerCase()}`
      if (!existingKeys.has(dedupeKey)) {
        finalTraits.push(normalized)
      }
    }
  }

  const uniqueTraits = dedupeTraits(finalTraits)
  if (uniqueTraits.length === 0) return null

  const breakdown: TraitRarityBreakdown[] = uniqueTraits.map(attr => {
    // Attempt to find the frequency from the selected market overlay.
    const marketMatch = marketRarity?.traits?.find(
      t => t.key.toLowerCase() === attr.trait_type.toLowerCase() && t.value.toLowerCase() === attr.value.toLowerCase()
    )
    
    const count = marketMatch?.tokenCount
    const supply = marketRarity?.supply
    
    let pct: number | undefined = undefined
    let contribution: number | undefined = undefined

    if (marketMatch?.percentage !== undefined) {
      pct = marketMatch.percentage
    } else if (count !== undefined && supply !== undefined && supply > 0) {
      pct = (count / supply) * 100
    }

    if (count !== undefined && supply !== undefined && supply > 0) {
      contribution = supply / count
    }

    return {
      trait_type: attr.trait_type,
      value: attr.value,
      frequency: count,
      frequency_pct: pct ? Math.round(pct * 100) / 100 : undefined,
      rarity_contribution: contribution ? Math.round(contribution * 10000) / 10000 : undefined,
    }
  })

  // Sort breakdown by rarity contribution descending (rarest first), if available
  breakdown.sort((a, b) => {
    if (a.rarity_contribution && b.rarity_contribution) {
      return b.rarity_contribution - a.rarity_contribution
    }
    return 0
  })

  const rank = marketRarity?.rank ?? null
  const supply = marketRarity?.supply ?? null
  let percentile: number | null = null
  
  if (rank && supply && supply > 0) {
    percentile = Math.round((rank / supply) * 10000) / 100
  }

  return {
    rarity_score: null, // We no longer compute the raw total score
    rarity_rank: rank,
    rarity_percentile: percentile,
    total_supply: supply,
    traits: uniqueTraits,
    trait_breakdown: breakdown,
    computed_at: new Date().toISOString(),
  }
}

function normalizeTraitPair(
  traitType: string,
  value: string
): TraitAttribute | null {
  const normalizedType = traitType.trim()
  const normalizedValue = value.trim()

  if (!normalizedType || !normalizedValue) return null
  return {
    trait_type: normalizedType,
    value: normalizedValue,
  }
}

function dedupeTraits(traits: TraitAttribute[]): TraitAttribute[] {
  const unique = new Map<string, TraitAttribute>()

  for (const trait of traits) {
    const key = `${trait.trait_type.toLowerCase()}\u0000${trait.value.toLowerCase()}`
    if (!unique.has(key)) {
      unique.set(key, trait)
    }
  }

  return [...unique.values()]
}
