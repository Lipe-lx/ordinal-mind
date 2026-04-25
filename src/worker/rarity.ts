// Rarity Engine — merges factual on-chain CBOR traits with Satflow frequency/rank data.
// 
// Instead of fetching the entire collection to compute statistics (which requires closed APIs),
// we use a Cypherpunk approach:
// 1. Fetch exact attributes from the inscription envelope (ord.net / CBOR)
// 2. Fetch global frequency stats and official rank from Satflow (HTML scrape)
// 3. Graceful degradation: if Satflow has no data, still display the traits without a global rank.

import type {
  InscriptionRarity,
  TraitAttribute,
  TraitRarityBreakdown,
  MarketOverlayMatch
} from "../app/lib/types"

export function buildInscriptionRarity(
  cborTraits: Record<string, string> | null,
  satflowRarity: MarketOverlayMatch["satflow_rarity"] | undefined
): InscriptionRarity | null {
  // We need at least CBOR traits or Satflow traits to build a rarity context
  if (!cborTraits && !satflowRarity?.traits) return null

  // Prioritize CBOR for the canonical list of traits, fallback to Satflow traits
  const finalTraits: TraitAttribute[] = []
  
  if (cborTraits) {
    for (const [key, value] of Object.entries(cborTraits)) {
      const normalized = normalizeTraitPair(key, value)
      if (normalized) finalTraits.push(normalized)
    }
  } else if (satflowRarity?.traits) {
    for (const t of satflowRarity.traits) {
      if (t.key === "Attributes") continue // skip the empty trait container
      const normalized = normalizeTraitPair(t.key, t.value)
      if (normalized) finalTraits.push(normalized)
    }
  }

  const uniqueTraits = dedupeTraits(finalTraits)
  if (uniqueTraits.length === 0) return null

  const breakdown: TraitRarityBreakdown[] = uniqueTraits.map(attr => {
    // Attempt to find the frequency from Satflow
    const satflowMatch = satflowRarity?.traits?.find(
      t => t.key.toLowerCase() === attr.trait_type.toLowerCase() && t.value.toLowerCase() === attr.value.toLowerCase()
    )
    
    const count = satflowMatch?.tokenCount
    const supply = satflowRarity?.supply
    
    let pct: number | undefined = undefined
    let contribution: number | undefined = undefined
    
    if (count !== undefined && supply !== undefined && supply > 0) {
      pct = (count / supply) * 100
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

  const rank = satflowRarity?.rank ?? null
  const supply = satflowRarity?.supply ?? null
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
