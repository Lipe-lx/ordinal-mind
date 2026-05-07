// wikiSeedAgent.ts — Parallel Wiki Seed Agent
// Pillar 2 — Chat Wiki Builder (Seed Layer)
//
// Fires after the first narrative response is finalized.
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
import { submitWikiContribution } from "./wikiSubmit"
import {
  CANONICAL_FIELDS,
  COLLECTION_ONLY_FIELDS,
  INSCRIPTION_ONLY_FIELDS,
  type CanonicalField,
} from "./wikiCompleteness"

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
  /** The finalized narrative text from the first chat response. */
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
Given a Chronicle narrative and compact inscription metadata, extract all factual claims as structured wiki fields.

Return ONLY a valid JSON array of objects. No surrounding text, no markdown code blocks.

Each object must have exactly these fields:
- "field": one of the canonical field names listed below
- "value": the factual claim as a concise string (max 300 chars)
- "verifiable": boolean — true if the claim is traceable to public on-chain data or a named source
- "scope": "collection" or "inscription"

Canonical fields and their allowed scopes:
- Collection-only: founder, launch_date, launch_context, origin_narrative, community_culture, connections, current_status
- Inscription-only: inscriber
- Either scope: artist, technical_details, notable_moments

Rules:
- Only extract facts explicitly stated in the narrative. Do not invent or infer unstated facts.
- If the narrative mentions a collection founder, artist, or launch date, extract them with scope "collection".
- If the narrative mentions the specific inscriber of this inscription, extract it with scope "inscription".
- Do not extract generic descriptions or timeline events — only structured wiki-relevant facts.
- If no extractable facts exist, return an empty array [].`

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

function buildSeedPrompt(narrative: string, chronicle: Chronicle): string {
  const collectionSlug =
    chronicle.collection_context.market.match?.collection_slug ??
    chronicle.collection_context.registry.match?.slug ??
    null

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

  return `${SEED_SYSTEM_PROMPT}

---
Inscription metadata:
${meta}

---
Chronicle narrative:
${narrative.slice(0, 2000)}

---
Extract wiki fields as a JSON array:`
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

function validateExtractedField(
  raw: unknown,
  chronicle: Chronicle
): ValidatedSeedField | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as RawExtractedField

  if (!isCanonicalField(r.field)) return null
  if (typeof r.value !== "string" || !r.value.trim()) return null

  const scope = r.scope === "inscription" ? "inscription" : "collection"

  // Enforce scope constraints
  const isInscriptionOnly = (INSCRIPTION_ONLY_FIELDS as string[]).includes(r.field)
  const isCollectionOnly = (COLLECTION_ONLY_FIELDS as string[]).includes(r.field)

  if (isInscriptionOnly && scope !== "inscription") return null
  if (isCollectionOnly && scope !== "collection") return null

  // Resolve the correct slug for this field
  const collectionSlug =
    chronicle.collection_context.market.match?.collection_slug ??
    chronicle.collection_context.registry.match?.slug ??
    null

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
    const key = `${field.collection_slug}|${field.field}|${field.value_norm}`
    const list = grouped.get(key) ?? []
    list.push(field)
    grouped.set(key, list)
  }

  const deduped: ValidatedSeedField[] = []
  for (const candidates of grouped.values()) {
    if (candidates.length === 1) {
      deduped.push(candidates[0])
      continue
    }

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
    })
  }

  return deduped.sort((left, right) =>
    left.collection_slug.localeCompare(right.collection_slug)
    || left.field.localeCompare(right.field)
    || left.value_norm.localeCompare(right.value_norm)
  )
}

async function extractFieldsFromNarrative(
  narrative: string,
  chronicle: Chronicle,
  config: ByokConfig
): Promise<ValidatedSeedField[]> {
  const prompt = buildSeedPrompt(narrative, chronicle)

  let raw: string
  try {
    raw = await runByokPrompt(config, prompt)
  } catch (err) {
    console.warn("[OrdinalMind][WikiSeedAgent] LLM call failed", {
      at: new Date().toISOString(),
      provider: config.provider,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  if (!raw) return []

  const parsed = parseFirstJsonObject(raw)
  if (!Array.isArray(parsed)) {
    // The model might have returned a JSON array directly — check for that too
    const trimmed = raw.trim()
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed)
        if (Array.isArray(arr)) {
          return arr
            .map((item) => validateExtractedField(item, chronicle))
            .filter((item): item is ValidatedSeedField => item !== null)
        }
      } catch {
        // fall through
      }
    }

    console.warn("[OrdinalMind][WikiSeedAgent] Failed to parse extraction result", {
      at: new Date().toISOString(),
      provider: config.provider,
      raw_chars: raw.length,
    })
    return []
  }

  return parsed
    .map((item) => validateExtractedField(item, chronicle))
    .filter((item): item is ValidatedSeedField => item !== null)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Launch the Wiki Seed Agent after the first narrative is finalized.
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

  const collectionSlug =
    chronicle.collection_context.market.match?.collection_slug ??
    chronicle.collection_context.registry.match?.slug ??
    null

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

    const extractedFields = await extractFieldsFromNarrative(narrative, chronicle, config)
    const fields = dedupeSeedFields(extractedFields)

    if (fields.length === 0) {
      console.info("[OrdinalMind][WikiSeedAgent] No extractable wiki fields found", {
        at: new Date().toISOString(),
        inscription_id: chronicle.meta.inscription_id,
      })
      onProgress?.({
        state: "done",
        fieldsExtracted: 0,
        fieldsSubmitted: 0,
        label: "Wiki seed complete (no new fields found).",
      })
      return
    }

    console.info("[OrdinalMind][WikiSeedAgent] Fields extracted", {
      at: new Date().toISOString(),
      inscription_id: chronicle.meta.inscription_id,
      extracted_count: extractedFields.length,
      deduped_count: fields.length,
      fields: fields.map((f) => f.field),
    })

    // Phase 2: Submit extracted fields
    onProgress?.({
      state: "submitting",
      fieldsExtracted: fields.length,
      fieldsSubmitted: 0,
      label: `Submitting ${fields.length} wiki field${fields.length !== 1 ? "s" : ""} from narrative…`,
    })

    let submitted = 0
    const results = await Promise.allSettled(
      fields.map((field) =>
        submitWikiContribution({
          data: {
            collection_slug: field.collection_slug,
            field: field.field,
            value: field.value,
            operation: "add",
            confidence: "inferred",
            verifiable: field.verifiable,
            session_id: sessionId,
            source_excerpt: `[Narrative seed] ${narrative.slice(0, 200)}`,
          },
          activeThreadId: sessionId,
          prompt: "[wiki_seed_agent]",
        })
      )
    )

    submitted = results.filter(
      (r) => r.status === "fulfilled" && r.value.ok
    ).length

    const duplicates = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        r.value.ok &&
        (r.value as { status?: string }).status === "duplicate"
    ).length

    console.info("[OrdinalMind][WikiSeedAgent] Seed complete", {
      at: new Date().toISOString(),
      inscription_id: chronicle.meta.inscription_id,
      extracted: fields.length,
      submitted,
      duplicates,
      errors: results.filter((r) => r.status === "rejected").length,
    })

    const label =
      submitted === 0
        ? "Wiki seed complete (all fields already known)."
        : `Wiki seeded with ${submitted} field${submitted !== 1 ? "s" : ""} from narrative.`

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
