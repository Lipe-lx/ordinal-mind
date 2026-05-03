// wikiExtractor.ts — Parser for <wiki_extract> blocks emitted by the LLM.
// Pillar 2 — Chat Wiki Builder
//
// The LLM, when in Wiki Builder mode, appends a hidden structured block to its
// response. This module parses that block and removes it from the visible text.
//
// Block format (JSON inside tags):
//   <wiki_extract>
//   { "field": "founder", "value": "...", "confidence": "stated_by_user",
//     "verifiable": true, "collection_slug": "...", "source_chat_excerpt": "..." }
//   </wiki_extract>
//
// The block is ALWAYS hidden from the user. It is stripped from the display text.

import type { CanonicalField } from "./wikiCompleteness"
import { CANONICAL_FIELDS } from "./wikiCompleteness"

export interface WikiExtractData {
  field: CanonicalField
  value: string
  confidence: "stated_by_user" | "inferred" | "correcting_existing"
  verifiable: boolean
  collection_slug: string
  source_chat_excerpt: string
}

export interface WikiExtractResult {
  /** The extracted structured contribution data, or null if none found/invalid. */
  data: WikiExtractData | null
  /** The LLM response text with the <wiki_extract> block removed. */
  cleanText: string
}

const EXTRACT_TAG_RE = /<wiki_extract>([\s\S]*?)<\/wiki_extract>/i

/**
 * Parse and remove <wiki_extract> block from LLM response text.
 *
 * @param text - Raw LLM response text (may contain <wiki_extract> block)
 * @returns WikiExtractResult with parsed data and cleaned text
 */
export function parseWikiExtract(text: string): WikiExtractResult {
  const match = EXTRACT_TAG_RE.exec(text)

  if (!match) {
    return { data: null, cleanText: text }
  }

  // Remove the block from the visible text regardless of parse success
  const cleanText = text.replace(EXTRACT_TAG_RE, "").trim()

  const rawContent = match[1].trim()
  const data = parseExtractContent(rawContent)

  return { data, cleanText }
}

/**
 * Check if a response text contains a wiki_extract block.
 */
export function hasWikiExtract(text: string): boolean {
  return EXTRACT_TAG_RE.test(text)
}

function parseExtractContent(raw: string): WikiExtractData | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Try to find JSON object within the block (model may add extra text)
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) return null

    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return null
    }
  }

  return validateExtractData(parsed)
}

function validateExtractData(data: unknown): WikiExtractData | null {
  if (!data || typeof data !== "object") return null

  const d = data as Record<string, unknown>

  // field must be a known canonical field
  if (!isCanonicalField(d.field)) return null

  // value must be a non-empty string
  if (typeof d.value !== "string" || !d.value.trim()) return null

  // confidence must be one of the valid values
  const confidence = d.confidence
  if (
    confidence !== "stated_by_user" &&
    confidence !== "inferred" &&
    confidence !== "correcting_existing"
  ) return null

  // collection_slug must be present
  if (typeof d.collection_slug !== "string" || !d.collection_slug.trim()) return null

  // source_chat_excerpt must be a string (can be empty)
  const excerpt = typeof d.source_chat_excerpt === "string"
    ? d.source_chat_excerpt.slice(0, 500)
    : ""

  return {
    field: d.field,
    value: (d.value as string).trim(),
    confidence,
    verifiable: Boolean(d.verifiable),
    collection_slug: (d.collection_slug as string).trim(),
    source_chat_excerpt: excerpt,
  }
}

function isCanonicalField(value: unknown): value is CanonicalField {
  return typeof value === "string" && (CANONICAL_FIELDS as string[]).includes(value)
}
