// wikiSeedAgent.ts — Parallel Wiki Seed Agent
// Pillar 2 — Chat Wiki Builder (Seed Layer)
//
// Fires after a finalized narrative response is available.
// Makes a lightweight, dedicated BYOK LLM call to extract structured wiki
// fields from the narrative and submits them as wiki contributions.
//
// Contract:
// - Client-side only. The user's LLM key never leaves the browser.
// - Fire-and-forget: never throws. All errors are caught internally.
// - Independent of the main chat agent: no shared mutable state.
// - Respects field scope rules enforced by the backend.

import type { Chronicle } from "../types"
import { chooseCanonicalWikiValue, normalizeWikiValue } from "../wikiNormalization"
import type { ByokConfig } from "./index"
import { runByokPrompt, parseFirstJsonObject } from "./wikiAdapter"
import { submitWikiContribution, type WikiSubmitError, type WikiSubmitResult } from "./wikiSubmit"
import {
  CANONICAL_FIELDS,
  COLLECTION_ONLY_FIELDS,
  INSCRIPTION_ONLY_FIELDS,
  fetchConsolidated,
  type CanonicalField,
} from "./wikiCompleteness"
import type { ConsolidatedCollection } from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WikiSeedState = "extracting" | "submitting" | "done" | "error"

export interface WikiSeedStatus {
  state: WikiSeedState
  fieldsExtracted: number
  fieldsSubmitted: number
  label: string
}

export interface WikiSeedAgentParams {
  /** The finalized narrative text from a chat response. */
  narrative: string
  /** Full Chronicle data for this inscription. */
  chronicle: Chronicle
  /** User's BYOK configuration (key never sent to our server). */
  config: ByokConfig
  /** Active chat thread ID for session tracking. */
  sessionId: string | null
  /** Optional progress callback for UI activity indicator. */
  onProgress?: (status: WikiSeedStatus) => void
}

// ---------------------------------------------------------------------------
// Seed System Prompt
// ---------------------------------------------------------------------------

const SEED_SYSTEM_PROMPT = `You are a factual data extractor for Bitcoin Ordinals wiki entries.
Given a Chronicle narrative and compact inscription metadata, extract factual claims as structured wiki fields.

Return ONLY a valid JSON object with this exact shape:
{
  "fields": [
    {
      "field": "<canonical_field>",
      "value": "<concise factual claim, max 300 chars>",
      "verifiable": true,
      "scope": "collection" | "inscription"
    }
  ]
}

If no extractable facts exist, return {"fields": []}. Do not return markdown or extra text.

Rules:
- Use only facts explicitly stated in the narrative.
- Never invent facts and never infer unstated details.
- For each (scope, field), return at most one best value.
- Canonical fields: name, founder, artist, inscriber, launch_date, launch_context, origin_narrative, community_culture, connections, current_status, technical_details, notable_moments.
- Scope must match the factual target of the claim: "collection" if the fact describes the entire collection, or "inscription" if it describes this specific item.`

type SeedExtractionPhase = "collection" | "inscription"

function normalizeCollectionSlugForSeed(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith("collection:") ? trimmed.slice("collection:".length) : trimmed
}

function resolveCollectionSlug(chronicle: Chronicle): string | null {
  // Prefer curated registry slug when available to avoid market-overlay alias drift
  // (e.g., hyphen/underscore variants creating separate wiki records).
  return normalizeCollectionSlugForSeed(chronicle.collection_context.registry.match?.slug)
    ?? normalizeCollectionSlugForSeed(chronicle.collection_context.market.match?.collection_slug)
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

function buildSeedPrompt(
  narrative: string,
  chronicle: Chronicle,
  phase: SeedExtractionPhase,
  excludedScopeFieldKeys: Set<string>
): string {
  const collectionSlug =
    resolveCollectionSlug(chronicle)

  const collectionName =
    chronicle.collection_context.profile?.name ??
    chronicle.collection_context.presentation.primary_label ??
    chronicle.collection_context.market.match?.collection_name ??
    null

  const meta = [
    `inscription_id: ${chronicle.meta.inscription_id}`,
    `inscription_number: #${chronicle.meta.inscription_number}`,
    collectionSlug ? `collection_slug: ${collectionSlug}` : null,
    collectionName ? `collection_name: ${collectionName}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const phaseInstruction =
    phase === "collection"
      ? "Phase focus: collection scope. Extract facts that describe the collection as a whole (history, overall founders, general launch, community context)."
      : "Phase focus: inscription scope. Extract facts that are unique to THIS specific inscription (its specific creator, its unique meaning, its individual provenance)."

  const allowedFields = CANONICAL_FIELDS.filter((field) => isFieldAllowedInPhase(field, phase))

  const excluded =
    excludedScopeFieldKeys.size > 0
      ? [...excludedScopeFieldKeys].sort().join(", ")
      : "none"

  return `${SEED_SYSTEM_PROMPT}

---
Inscription metadata:
${meta}

---
Chronicle narrative:
${narrative.slice(0, 2000)}

---
${phaseInstruction}
Allowed fields in this phase: ${allowedFields.join(", ")}.
Do not return any item whose (scope, field) is already in this set: ${excluded}.
Return only {"fields":[...]} now.`
}

// ---------------------------------------------------------------------------
// Extraction and Validation
// ---------------------------------------------------------------------------

interface RawExtractedField {
  field: unknown
  value: unknown
  verifiable: unknown
  scope: unknown
}

interface ValidatedSeedField {
  field: CanonicalField
  value: string
  value_norm: string
  verifiable: boolean
  scope: "collection" | "inscription"
  collection_slug: string
}

function isCanonicalField(value: unknown): value is CanonicalField {
  return typeof value === "string" && (CANONICAL_FIELDS as string[]).includes(value)
}

function isScope(value: unknown): value is "collection" | "inscription" {
  return value === "collection" || value === "inscription"
}

function isCollectionOnlyField(field: CanonicalField): boolean {
  return (COLLECTION_ONLY_FIELDS as string[]).includes(field)
}

function isInscriptionOnlyField(field: CanonicalField): boolean {
  return (INSCRIPTION_ONLY_FIELDS as string[]).includes(field)
}

function isFieldAllowedInPhase(field: CanonicalField, phase: SeedExtractionPhase): boolean {
  if (phase === "collection") {
    return isCollectionOnlyField(field) || !isInscriptionOnlyField(field)
  }
  return isInscriptionOnlyField(field) || !isCollectionOnlyField(field)
}

function resolveScopeWithSafeFallback(
  rawScope: unknown,
  field: CanonicalField,
  phase: SeedExtractionPhase
): "collection" | "inscription" {
  // 1. Enforce logical defaults from the field lists first to prevent misclassification
  if (isInscriptionOnlyField(field)) return "inscription"
  if (isCollectionOnlyField(field)) return "collection"
  
  // 2. If it's a shared field, check if the LLM provided a valid scope
  if (isScope(rawScope)) return rawScope
  
  // 3. Final fallback is the current extraction phase focus
  return phase
}

function toScopeFieldKey(scope: "collection" | "inscription", field: CanonicalField): string {
  return `${scope}:${field}`
}

function validateExtractedField(
  raw: unknown,
  chronicle: Chronicle,
  phase: SeedExtractionPhase
): ValidatedSeedField | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as RawExtractedField

  if (!isCanonicalField(r.field)) return null
  if (!isFieldAllowedInPhase(r.field, phase)) return null
  if (typeof r.value !== "string" || !r.value.trim()) return null

  const scope = resolveScopeWithSafeFallback(r.scope, r.field, phase)

  // Enforce scope constraints
  const isInscriptionOnly = isInscriptionOnlyField(r.field)
  const isCollectionOnly = isCollectionOnlyField(r.field)

  if (isInscriptionOnly && scope !== "inscription") return null
  if (isCollectionOnly && scope !== "collection") return null

  // Resolve the correct slug for this field
  const collectionSlug = resolveCollectionSlug(chronicle)

  const inscriptionId = chronicle.meta.inscription_id

  let resolvedSlug: string
  if (scope === "inscription" || isInscriptionOnly) {
    resolvedSlug = inscriptionId
  } else {
    if (!collectionSlug) return null // Can't submit collection field without a slug
    resolvedSlug = collectionSlug
  }

  return {
    field: r.field,
    value: r.value.trim().slice(0, 300),
    value_norm: normalizeWikiValue(r.value.trim().slice(0, 300)),
    verifiable: Boolean(r.verifiable),
    scope,
    collection_slug: resolvedSlug,
  }
}

function dedupeSeedFields(fields: ValidatedSeedField[]): ValidatedSeedField[] {
  if (fields.length <= 1) return fields

  const grouped = new Map<string, ValidatedSeedField[]>()
  for (const field of fields) {
    const key = `${field.collection_slug}|${field.field}`
    const list = grouped.get(key) ?? []
    list.push(field)
    grouped.set(key, list)
  }

  const deduped: ValidatedSeedField[] = []
  for (const candidates of grouped.values()) {
    const canonicalValue = chooseCanonicalWikiValue(candidates.map((item) => item.value))
    const best = [...candidates].sort((left, right) => {
      const verifiableDiff = Number(right.verifiable) - Number(left.verifiable)
      if (verifiableDiff !== 0) return verifiableDiff
      return left.value.localeCompare(right.value)
    })[0]

    if (!best) continue
    deduped.push({
      ...best,
      value: canonicalValue,
      value_norm: normalizeWikiValue(canonicalValue),
      verifiable: candidates.some((item) => item.verifiable),
    })
  }

  return deduped.sort((left, right) =>
    left.collection_slug.localeCompare(right.collection_slug)
    || left.field.localeCompare(right.field)
    || left.scope.localeCompare(right.scope)
  )
}

function tryParseJsonArray(value: string): unknown[] | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      if (Array.isArray(record.fields)) return record.fields
      if (Array.isArray(record.items)) return record.items
    }
  } catch {
    // keep trying below
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) {
    const fenced = tryParseJsonArray(fenceMatch[1])
    if (fenced) return fenced
  }

  const start = trimmed.indexOf("[")
  const end = trimmed.lastIndexOf("]")
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // fall through
    }
  }

  return null
}

function parseExtractedFieldsPayload(raw: string): unknown[] | null {
  const firstParse = parseFirstJsonObject(raw)
  if (Array.isArray(firstParse)) return firstParse
  if (firstParse && typeof firstParse === "object") {
    const record = firstParse as Record<string, unknown>
    if (Array.isArray(record.fields)) return record.fields
    if (Array.isArray(record.items)) return record.items
  }
  return tryParseJsonArray(raw)
}

function buildScopeFieldKeySet(fields: ValidatedSeedField[]): Set<string> {
  return new Set(fields.map((field) => toScopeFieldKey(field.scope, field.field)))
}

async function fetchConsolidatedBySlug(slug: string): Promise<ConsolidatedCollection | null> {
  try {
    return await fetchConsolidated(slug)
  } catch {
    return null
  }
}

function shouldSkipFieldByCanonicalMatch(
  field: ValidatedSeedField,
  consolidated: ConsolidatedCollection | null
): boolean {
  if (!consolidated) return false
  const state = consolidated.narrative?.[field.field]
  if (!state || typeof state.canonical_value !== "string" || !state.canonical_value.trim()) return false
  return normalizeWikiValue(state.canonical_value) === field.value_norm
}

async function prefilterSeedFieldsByCurrentCanonicalState(
  fields: ValidatedSeedField[]
): Promise<{ filtered: ValidatedSeedField[]; skipped: number }> {
  if (fields.length === 0) return { filtered: fields, skipped: 0 }

  const uniqueSlugs = [...new Set(fields.map((field) => field.collection_slug))]
  const snapshots = new Map<string, ConsolidatedCollection | null>()

  await Promise.all(
    uniqueSlugs.map(async (slug) => {
      snapshots.set(slug, await fetchConsolidatedBySlug(slug))
    })
  )

  const filtered = fields.filter((field) => {
    const snapshot = snapshots.get(field.collection_slug) ?? null
    return !shouldSkipFieldByCanonicalMatch(field, snapshot)
  })

  return {
    filtered,
    skipped: Math.max(0, fields.length - filtered.length),
  }
}

async function extractFieldsFromNarrative(
  narrative: string,
  chronicle: Chronicle,
  config: ByokConfig,
  phase: SeedExtractionPhase,
  excludedScopeFieldKeys: Set<string>
): Promise<ValidatedSeedField[]> {
  const prompt = buildSeedPrompt(narrative, chronicle, phase, excludedScopeFieldKeys)

  let raw: string
  try {
    raw = await runByokPrompt(config, prompt, {
      mode: "wiki_seed",
      systemPrompt: SEED_SYSTEM_PROMPT,
      responseFormat: "json_object",
      requestLabel: "gemini_wiki_seed",
    })
  } catch (err) {
    console.warn("[OrdinalMind][WikiSeedAgent] LLM call failed", {
      at: new Date().toISOString(),
      provider: config.provider,
      phase,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  if (!raw) return []

  const parsedArray = parseExtractedFieldsPayload(raw)
  if (!parsedArray) {
    console.warn("[OrdinalMind][WikiSeedAgent] Failed to parse extraction result", {
      at: new Date().toISOString(),
      provider: config.provider,
      phase,
      raw_chars: raw.length,
    })
    return []
  }

  const filteredByMissingKeys = parsedArray
    .map((item) => validateExtractedField(item, chronicle, phase))
    .filter((item): item is ValidatedSeedField => item !== null)
    .filter((item) => !excludedScopeFieldKeys.has(toScopeFieldKey(item.scope, item.field)))

  return filteredByMissingKeys
}

function shouldRetrySeedSubmission(result: WikiSubmitResult | WikiSubmitError): boolean {
  if (result.ok) return false
  const status = result.http_status ?? 0
  if ([429, 500, 502, 503, 504].includes(status)) return true
  return /db_write_failed|http_5\d\d|rate_limited/i.test(result.error)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function submitSeedFieldWithRetry(
  field: ValidatedSeedField,
  narrative: string,
  sessionId: string | null
): Promise<WikiSubmitResult | WikiSubmitError> {
  const maxRetries = 2
  for (let attempt = 0; ; attempt += 1) {
    const result = await submitWikiContribution({
      data: {
        collection_slug: field.collection_slug,
        field: field.field,
        value: field.value,
        operation: "add",
        confidence: "inferred",
        verifiable: field.verifiable,
        session_id: sessionId,
        origin: "narrative_seed_agent",
        source_excerpt: `[Narrative seed] ${narrative.slice(0, 200)}`,
      },
      activeThreadId: sessionId,
      prompt: "[wiki_seed_agent]",
    })

    if (!shouldRetrySeedSubmission(result) || attempt >= maxRetries) {
      return result
    }

    const delayMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 200)
    console.warn("[OrdinalMind][WikiSeedAgent] Retrying seed contribution", {
      at: new Date().toISOString(),
      slug: field.collection_slug,
      field: field.field,
      attempt: attempt + 1,
      max_retries: maxRetries,
      delay_ms: delayMs,
      reason: result.ok ? "unknown" : result.error,
      status: result.http_status ?? null,
    })
    await sleep(delayMs)
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Launch the Wiki Seed Agent after a narrative is finalized.
 *
 * This function is designed to be called fire-and-forget:
 *   void runWikiSeedAgent(params)
 *
 * It never throws. All errors are caught internally and reported
 * through the optional onProgress callback only.
 */
export async function runWikiSeedAgent(params: WikiSeedAgentParams): Promise<void> {
  const { narrative, chronicle, config, sessionId, onProgress } = params

  if (!narrative.trim() || !config.key) {
    return
  }

  const collectionSlug = resolveCollectionSlug(chronicle)

  // Need at least one slug context to seed anything useful
  if (!collectionSlug && !chronicle.meta.inscription_id) {
    return
  }

  console.info("[OrdinalMind][WikiSeedAgent] Starting seed extraction", {
    at: new Date().toISOString(),
    inscription_id: chronicle.meta.inscription_id,
    collection_slug: collectionSlug,
    provider: config.provider,
    narrative_chars: narrative.length,
  })

  try {
    // Phase 1: Extract fields from narrative
    onProgress?.({
      state: "extracting",
      fieldsExtracted: 0,
      fieldsSubmitted: 0,
      label: "Seeding wiki from narrative…",
    })

    const phaseOneFields = await extractFieldsFromNarrative(
      narrative,
      chronicle,
      config,
      "collection",
      new Set<string>()
    )
    const phaseOneDeduped = dedupeSeedFields(phaseOneFields)
    const phaseTwoExcludedKeys = buildScopeFieldKeySet(phaseOneDeduped)
    const phaseTwoFields = await extractFieldsFromNarrative(
      narrative,
      chronicle,
      config,
      "inscription",
      phaseTwoExcludedKeys
    )

    const extractedFields = [...phaseOneDeduped, ...phaseTwoFields]
    const dedupedFields = dedupeSeedFields(extractedFields)
    const prefiltered = await prefilterSeedFieldsByCurrentCanonicalState(dedupedFields)
    const fields = prefiltered.filtered

    if (fields.length === 0) {
      console.info("[OrdinalMind][WikiSeedAgent] No extractable wiki fields found", {
        at: new Date().toISOString(),
        inscription_id: chronicle.meta.inscription_id,
        phase_one_count: phaseOneFields.length,
        phase_two_count: phaseTwoFields.length,
        extracted_count: extractedFields.length,
        deduped_count: dedupedFields.length,
        skipped_by_canonical_match: prefiltered.skipped,
      })
      onProgress?.({
        state: "done",
        fieldsExtracted: dedupedFields.length,
        fieldsSubmitted: 0,
        label: "Wiki seed complete (all fields already canonical).",
      })
      return
    }

    console.info("[OrdinalMind][WikiSeedAgent] Fields extracted", {
      at: new Date().toISOString(),
      inscription_id: chronicle.meta.inscription_id,
      phase_one_count: phaseOneFields.length,
      phase_two_count: phaseTwoFields.length,
      extracted_count: extractedFields.length,
      deduped_count: dedupedFields.length,
      ready_to_submit_count: fields.length,
      skipped_by_canonical_match: prefiltered.skipped,
      fields: fields.map((f) => f.field),
    })

    // Phase 2: Submit extracted fields
    onProgress?.({
      state: "submitting",
      fieldsExtracted: fields.length,
      fieldsSubmitted: 0,
      label: `Submitting ${fields.length} wiki field${fields.length !== 1 ? "s" : ""} from narrative…`,
    })

    const results: Array<WikiSubmitResult | WikiSubmitError> = []
    for (const field of fields) {
      results.push(await submitSeedFieldWithRetry(field, narrative, sessionId))
    }

    const submitted = results.filter(
      (r) => r.ok && (r.status === "published" || r.status === "quarantine")
    ).length

    const duplicates = results.filter(
      (r) => r.ok && r.status === "duplicate"
    ).length

    const protectedByHumanContribution = results.filter(
      (r) => r.ok && r.detail === "protected_human_contribution"
    ).length

    console.info("[OrdinalMind][WikiSeedAgent] Seed complete", {
      at: new Date().toISOString(),
      inscription_id: chronicle.meta.inscription_id,
      phase_one_count: phaseOneFields.length,
      phase_two_count: phaseTwoFields.length,
      extracted: extractedFields.length,
      deduped: dedupedFields.length,
      skipped_by_canonical_match: prefiltered.skipped,
      attempted: fields.length,
      updated_or_inserted: submitted,
      duplicates,
      protected_by_human_contribution: protectedByHumanContribution,
      errors: results.filter((r) => !r.ok).length,
    })

    const label =
      submitted === 0
        ? (protectedByHumanContribution > 0
            ? "Wiki seed complete (fields protected by human contributions)."
            : duplicates > 0
              ? "Wiki seed complete (fields already synchronized)."
              : "Wiki seed complete (no deterministic updates needed).")
        : `Wiki seed synced ${submitted} field${submitted !== 1 ? "s" : ""} with system Genesis authority.`

    onProgress?.({
      state: "done",
      fieldsExtracted: fields.length,
      fieldsSubmitted: submitted,
      label,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn("[OrdinalMind][WikiSeedAgent] Unexpected error", {
      at: new Date().toISOString(),
      inscription_id: chronicle.meta.inscription_id,
      error: message,
    })
    onProgress?.({
      state: "error",
      fieldsExtracted: 0,
      fieldsSubmitted: 0,
      label: "Wiki seed failed (non-critical).",
    })
  }
}
