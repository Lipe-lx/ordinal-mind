export function normalizeCollectionSlugInput(slug: string): string {
  const trimmed = slug.trim()
  return trimmed.startsWith("collection:") ? trimmed.slice("collection:".length) : trimmed
}

export function buildCollectionSlugAliases(slug: string): string[] {
  const base = normalizeCollectionSlugInput(slug)
  if (!base) return []

  const lower = base.toLowerCase()
  const dash = lower.replace(/_/g, "-").replace(/\s+/g, "-")
  const underscore = lower.replace(/-/g, "_").replace(/\s+/g, "_")
  const slugified = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const slugifiedUnderscore = slugified.replace(/-/g, "_")
  const aggressive = lower.replace(/[^a-z0-9]/g, "")

  return Array.from(new Set([
    base,
    lower,
    dash,
    underscore,
    slugified,
    slugifiedUnderscore,
    aggressive,
  ].filter(Boolean)))
}

export function slugifyCollectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function toCollectionWikiPageSlug(collectionSlug: string): string {
  return `collection:${normalizeCollectionSlugInput(collectionSlug)}`
}

