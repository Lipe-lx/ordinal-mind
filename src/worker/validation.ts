// Cross-source data validation — triangulates facts between ordinals.com, mempool.space, and UniSat.
// Produces a confidence assessment and flags mismatches.

import type {
  InscriptionMeta,
  DataValidationCheck,
  DataValidationResult,
} from "../app/lib/types"
import type { UnisatInscriptionInfo } from "./agents/unisat"

/**
 * Validates inscription data across multiple sources.
 * Compares ordinals.com metadata with UniSat indexer data.
 * Returns a confidence level and per-field validation checks.
 */
export function validateAcrossSources(
  ordinalsMeta: InscriptionMeta,
  unisatInfo: UnisatInscriptionInfo | null
): DataValidationResult {
  const checks: DataValidationCheck[] = []

  if (!unisatInfo) {
    // Only one source available — medium confidence by default
    return {
      confidence: "medium",
      checks: [{
        field: "unisat_availability",
        sources_agree: false,
        values: [
          { source: "ordinals.com", value: "available" },
          { source: "unisat", value: "unavailable" },
        ],
        note: "UniSat data was not available for cross-validation",
      }],
      validated_at: new Date().toISOString(),
    }
  }

  // Check 1: Sat number
  if (ordinalsMeta.sat > 0 && unisatInfo.sat > 0) {
    checks.push({
      field: "sat_number",
      sources_agree: ordinalsMeta.sat === unisatInfo.sat,
      values: [
        { source: "ordinals.com", value: String(ordinalsMeta.sat) },
        { source: "unisat", value: String(unisatInfo.sat) },
      ],
      note: ordinalsMeta.sat === unisatInfo.sat
        ? "Sat number confirmed across both indexers"
        : "Sat number mismatch — data may be stale in one source",
    })
  }

  // Check 2: Owner address
  if (ordinalsMeta.owner_address && ordinalsMeta.owner_address !== "?" && unisatInfo.address) {
    const agree = ordinalsMeta.owner_address.toLowerCase() === unisatInfo.address.toLowerCase()
    checks.push({
      field: "owner_address",
      sources_agree: agree,
      values: [
        { source: "ordinals.com", value: ordinalsMeta.owner_address },
        { source: "unisat", value: unisatInfo.address },
      ],
      note: agree
        ? "Current owner confirmed across both indexers"
        : "Owner address differs — likely a recent transfer not yet indexed by one source",
    })
  }

  // Check 3: Content type
  if (ordinalsMeta.content_type && unisatInfo.contentType) {
    const agree = ordinalsMeta.content_type.toLowerCase() === unisatInfo.contentType.toLowerCase()
    checks.push({
      field: "content_type",
      sources_agree: agree,
      values: [
        { source: "ordinals.com", value: ordinalsMeta.content_type },
        { source: "unisat", value: unisatInfo.contentType },
      ],
    })
  }

  // Check 4: Genesis block height
  if (ordinalsMeta.genesis_block > 0 && unisatInfo.height > 0) {
    const agree = ordinalsMeta.genesis_block === unisatInfo.height
    checks.push({
      field: "genesis_height",
      sources_agree: agree,
      values: [
        { source: "ordinals.com", value: String(ordinalsMeta.genesis_block) },
        { source: "unisat", value: String(unisatInfo.height) },
      ],
      note: agree
        ? "Genesis block confirmed — immutable on-chain fact"
        : "Genesis block mismatch — critical discrepancy",
    })
  }

  // Check 5: Inscription number
  if (ordinalsMeta.inscription_number > 0 && unisatInfo.inscriptionNumber > 0) {
    const agree = ordinalsMeta.inscription_number === unisatInfo.inscriptionNumber
    checks.push({
      field: "inscription_number",
      sources_agree: agree,
      values: [
        { source: "ordinals.com", value: String(ordinalsMeta.inscription_number) },
        { source: "unisat", value: String(unisatInfo.inscriptionNumber) },
      ],
    })
  }

  // Compute confidence
  const totalChecks = checks.length
  const agreeing = checks.filter(c => c.sources_agree).length

  let confidence: DataValidationResult["confidence"]
  if (totalChecks === 0) {
    confidence = "low"
  } else if (agreeing === totalChecks) {
    confidence = "high"
  } else if (agreeing >= totalChecks * 0.6) {
    confidence = "medium"
  } else {
    confidence = "low"
  }

  return {
    confidence,
    checks,
    validated_at: new Date().toISOString(),
  }
}

/**
 * Merge UniSat charms into existing sat_rarity data.
 * UniSat provides explicit charm names that ordinals.com exposes
 * implicitly through sat rarity classification.
 */
export function mergeCharms(
  existingRarity: InscriptionMeta["sat_rarity"],
  unisatCharms: string[] | undefined
): string[] {
  if (!unisatCharms || unisatCharms.length === 0) {
    // If ordinals.com gives us a non-common rarity, represent it as a charm
    if (existingRarity && existingRarity !== "common") {
      return [existingRarity]
    }
    return []
  }

  // Deduplicate: UniSat charms + ordinals.com rarity
  const charmSet = new Set(unisatCharms.map(c => c.toLowerCase()))
  if (existingRarity && existingRarity !== "common") {
    charmSet.add(existingRarity.toLowerCase())
  }

  return [...charmSet]
}
