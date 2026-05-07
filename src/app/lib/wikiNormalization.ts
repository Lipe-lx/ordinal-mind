const PUNCT_OR_SYMBOL_RE = /[^\p{L}\p{N}\s]/gu
const MULTI_SPACE_RE = /\s+/g
const COMBINING_MARK_RE = /[\u0300-\u036f]/g

/**
 * Strong normalization for wiki contribution values.
 * Keeps letters/numbers, removes punctuation noise and diacritics,
 * lowercases in unicode space, and collapses whitespace.
 */
export function normalizeWikiValue(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  const noDiacritics = trimmed
    .normalize("NFKD")
    .replace(COMBINING_MARK_RE, "")

  return noDiacritics
    .toLocaleLowerCase("und")
    .replace(PUNCT_OR_SYMBOL_RE, " ")
    .replace(MULTI_SPACE_RE, " ")
    .trim()
}

/**
 * Picks a deterministic canonical representative from equivalent values.
 * Higher alphanumeric density wins, then longer text, then lexicographic ASC.
 */
export function chooseCanonicalWikiValue(values: string[]): string {
  if (values.length === 0) return ""
  if (values.length === 1) return values[0]

  const score = (input: string): number => {
    const alnumCount = (input.match(/[\p{L}\p{N}]/gu) ?? []).length
    return alnumCount * 10000 + input.length
  }

  const sorted = [...values].sort((left, right) => {
    const scoreDiff = score(right) - score(left)
    if (scoreDiff !== 0) return scoreDiff
    return left.localeCompare(right)
  })

  return sorted[0]
}
