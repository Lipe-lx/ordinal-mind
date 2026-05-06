import { strToU8, zipSync } from "fflate"
import type { Env } from "../index"
import { verifyJWT } from "../auth/jwt"
import { getConsolidatedSnapshot } from "./consolidateEndpoint"
import { getWikiSchemaFailure } from "./schema"
import type {
  ConsolidatedCollection,
  ConsolidatedField,
  ConsensusContribution,
} from "../../app/lib/types"

export interface WikiExportManifest {
  schema_version: string
  exported_at: string
  truth_mode: "public_with_explicit_status"
  counts: {
    wiki_pages: number
    consensus_records: number
    raw_events: number
  }
  excludes: string[]
  warnings: string[]
}

export interface ExportableWikiSection {
  heading: string
  body: string
  source_event_ids: string[]
  unverified_claims?: boolean
}

export interface ExportableWikiPage {
  slug: string
  entity_type: string
  title: string
  summary: string
  sections: ExportableWikiSection[]
  cross_refs: string[]
  source_event_ids: string[]
  generated_at: string
  byok_provider: string
  unverified_count: number
  view_count?: number
  updated_at?: string
}

export interface ExportableConsensusContribution {
  value: string
  og_tier: string
  weight: number
  created_at: string
}

export interface ExportableConsolidatedField extends Omit<ConsolidatedField, "contributions"> {
  contributions: ExportableConsensusContribution[]
}

export interface ExportableConsolidatedCollection {
  collection_slug: string
  scope: string
  sample_inscription_id: string | null
  completeness: ConsolidatedCollection["completeness"]
  confidence: number
  factual: ConsolidatedCollection["factual"]
  narrative: Record<string, ExportableConsolidatedField>
  sources: Array<{
    og_tier: string
    field: string
    created_at: string
  }>
  gaps: string[]
}

export interface ExportableRawEvent {
  id: string
  inscription_id: string
  event_type: string
  timestamp: string | null
  block_height: number | null
  source: {
    type: string
    ref: string
  }
  description: string
  metadata: Record<string, unknown>
}

export interface WikiExportSnapshot {
  manifest: WikiExportManifest
  wiki_pages: ExportableWikiPage[]
  consensus_records: ExportableConsolidatedCollection[]
  raw_events: ExportableRawEvent[]
}

interface WikiPageRow {
  slug: string
  entity_type: string
  title: string
  summary: string
  sections_json: string
  cross_refs_json: string
  source_event_ids_json: string
  generated_at: string
  byok_provider: string
  unverified_count: number
  view_count?: number
  updated_at?: string
}

interface RawEventRow {
  id: string
  inscription_id: string
  event_type: string
  timestamp: string | null
  block_height: number | null
  source_type: string
  source_ref: string
  description: string
  metadata_json: string
}

const EXPORT_SCHEMA_VERSION = "2026-05-06.1"
const EXCLUDED_DATA = [
  "wiki_log",
  "quarantine_contributions",
  "rejected_contributions",
  "duplicate_contributions",
  "contributor_id",
  "session_id",
  "source_excerpt",
  "jwt",
  "byok_keys",
]

export async function handleWikiExport(request: Request, env: Env): Promise<Response> {
  const actor = await requireAuthenticatedExportUser(request, env)
  if (actor instanceof Response) return actor

  const schemaFailure = await getWikiSchemaFailure(env)
  if (schemaFailure) {
    return jsonError({ ok: false, error: schemaFailure.error ?? "wiki_schema_missing" }, 503)
  }

  if (!env.DB) {
    return jsonError({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  try {
    const snapshot = await buildWikiExportSnapshot(env)
    const zipBytes = buildWikiExportZip(snapshot)
    const filename = buildExportFilename(snapshot.manifest.exported_at)

    return new Response(zipBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": buildContentDisposition(filename),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    })
  } catch (error) {
    console.error("[WikiExport] Error:", error)
    return jsonError({ ok: false, error: "wiki_export_failed" }, 500)
  }
}

export async function buildWikiExportSnapshot(env: Env): Promise<WikiExportSnapshot> {
  if (!env.DB) {
    throw new Error("wiki_db_unavailable")
  }

  const wikiPages = await fetchAllWikiPages(env)
  const consensusRecords = await fetchConsensusRecords(env)
  const rawEvents = await fetchReferencedRawEvents(env, wikiPages)

  const warnings: string[] = []
  if (wikiPages.some((page) => page.unverified_count > 0)) {
    warnings.push("Some wiki pages contain unverified claims.")
  }
  if (consensusRecords.some((record) => Object.values(record.narrative).some((field) => field.status !== "canonical"))) {
    warnings.push("Consensus exports include draft and disputed public knowledge with explicit status.")
  }

  return {
    manifest: {
      schema_version: EXPORT_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      truth_mode: "public_with_explicit_status",
      counts: {
        wiki_pages: wikiPages.length,
        consensus_records: consensusRecords.length,
        raw_events: rawEvents.length,
      },
      excludes: [...EXCLUDED_DATA],
      warnings,
    },
    wiki_pages: wikiPages,
    consensus_records: consensusRecords,
    raw_events: rawEvents,
  }
}

function buildWikiExportZip(snapshot: WikiExportSnapshot): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "README.md": strToU8(buildReadme(snapshot)),
    "manifest.json": strToU8(stableStringify(snapshot.manifest)),
    "wiki-pages/index.json": strToU8(stableStringify(buildWikiPageIndex(snapshot.wiki_pages))),
    "consensus/index.json": strToU8(stableStringify(buildConsensusIndex(snapshot.consensus_records))),
    "sources/raw-events.json": strToU8(stableStringify(snapshot.raw_events)),
  }

  for (const page of snapshot.wiki_pages) {
    const basePath = `wiki-pages/${page.entity_type}/${slugToFilename(page.slug)}`
    files[`${basePath}.json`] = strToU8(stableStringify(page))
    files[`${basePath}.md`] = strToU8(buildWikiPageMarkdown(page))
  }

  for (const record of snapshot.consensus_records) {
    const basePath = `consensus/${record.scope}/${slugToFilename(record.collection_slug)}`
    files[`${basePath}.json`] = strToU8(stableStringify(record))
    files[`${basePath}.md`] = strToU8(buildConsensusMarkdown(record))
  }

  return zipSync(files, { level: 0 })
}

async function requireAuthenticatedExportUser(request: Request, env: Env): Promise<{ discordId: string } | Response> {
  if (!env.JWT_SECRET) {
    return jsonError({ ok: false, error: "auth_not_configured" }, 503)
  }

  const authHeader = request.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) {
    return jsonError({ ok: false, error: "missing_auth_token" }, 401)
  }

  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload) {
    return jsonError({ ok: false, error: "invalid_auth_token" }, 401)
  }

  return { discordId: payload.sub }
}

async function fetchAllWikiPages(env: Env): Promise<ExportableWikiPage[]> {
  const rows = await env.DB!.prepare(`
    SELECT slug, entity_type, title, summary, sections_json,
           cross_refs_json, source_event_ids_json, generated_at,
           byok_provider, unverified_count, view_count, updated_at
    FROM wiki_pages
    ORDER BY slug ASC
  `)
    .all<WikiPageRow>()

  return (rows.results ?? [])
    .map((row) => ({
      slug: row.slug,
      entity_type: row.entity_type,
      title: row.title,
      summary: row.summary,
      sections: sortSections(safeJsonParse<ExportableWikiSection[]>(row.sections_json, [])),
      cross_refs: sortStrings(safeJsonParse<string[]>(row.cross_refs_json, [])),
      source_event_ids: sortStrings(safeJsonParse<string[]>(row.source_event_ids_json, [])),
      generated_at: row.generated_at,
      byok_provider: row.byok_provider,
      unverified_count: Number(row.unverified_count ?? 0),
      view_count: typeof row.view_count === "number" ? row.view_count : undefined,
      updated_at: row.updated_at,
    }))
}

async function fetchConsensusRecords(env: Env): Promise<ExportableConsolidatedCollection[]> {
  const rows = await env.DB!.prepare(`
    SELECT DISTINCT collection_slug
    FROM wiki_contributions
    WHERE status = 'published'
    ORDER BY collection_slug ASC
  `)
    .all<{ collection_slug: string }>()

  const records: ExportableConsolidatedCollection[] = []
  for (const row of rows.results ?? []) {
    const snapshot = await getConsolidatedSnapshot(row.collection_slug, env)
    records.push(sanitizeConsolidatedRecord(snapshot.data))
  }

  return records.sort((a, b) => a.collection_slug.localeCompare(b.collection_slug))
}

async function fetchReferencedRawEvents(
  env: Env,
  wikiPages: ExportableWikiPage[]
): Promise<ExportableRawEvent[]> {
  const referencedIds = new Set<string>()
  for (const page of wikiPages) {
    for (const eventId of page.source_event_ids) referencedIds.add(eventId)
    for (const section of page.sections) {
      for (const eventId of section.source_event_ids) referencedIds.add(eventId)
    }
  }

  const ids = [...referencedIds].sort()
  if (ids.length === 0) return []

  const rows: RawEventRow[] = []
  const chunkSize = 200

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize)
    const placeholders = chunk.map(() => "?").join(", ")
    const result = await env.DB!.prepare(`
      SELECT id, inscription_id, event_type, timestamp, block_height,
             source_type, source_ref, description, metadata_json
      FROM raw_chronicle_events
      WHERE id IN (${placeholders})
    `)
      .bind(...chunk)
      .all<RawEventRow>()

    rows.push(...(result.results ?? []))
  }

  return rows
    .map((row) => ({
      id: row.id,
      inscription_id: row.inscription_id,
      event_type: row.event_type,
      timestamp: row.timestamp,
      block_height: row.block_height,
      source: {
        type: row.source_type,
        ref: row.source_ref,
      },
      description: row.description,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    }))
    .sort((a, b) =>
      a.inscription_id.localeCompare(b.inscription_id)
      || String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? ""))
      || a.id.localeCompare(b.id)
    )
}

function sanitizeConsolidatedRecord(record: ConsolidatedCollection): ExportableConsolidatedCollection {
  const narrativeEntries = Object.entries(record.narrative)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, value]) => [field, sanitizeConsolidatedField(value)] as const)

  return {
    collection_slug: record.collection_slug,
    scope: resolveConsensusScope(record.collection_slug),
    sample_inscription_id: record.sample_inscription_id,
    completeness: record.completeness,
    confidence: record.confidence,
    factual: record.factual,
    narrative: Object.fromEntries(narrativeEntries),
    sources: [...record.sources]
      .map((source) => ({
        og_tier: source.og_tier,
        field: source.field,
        created_at: source.created_at,
      }))
      .sort((a, b) =>
        a.field.localeCompare(b.field)
        || a.created_at.localeCompare(b.created_at)
        || a.og_tier.localeCompare(b.og_tier)
      ),
    gaps: [...record.gaps].sort(),
  }
}

function sanitizeConsolidatedField(field: ConsolidatedField): ExportableConsolidatedField {
  return {
    field: field.field,
    canonical_value: field.canonical_value,
    status: field.status,
    resolved_by_tier: field.resolved_by_tier,
    contributions: field.contributions
      .map((contribution) => sanitizeContribution(contribution))
      .sort((a, b) =>
        b.weight - a.weight
        || b.created_at.localeCompare(a.created_at)
        || a.value.localeCompare(b.value)
      ),
  }
}

function sanitizeContribution(contribution: ConsensusContribution): ExportableConsensusContribution {
  return {
    value: contribution.value,
    og_tier: contribution.og_tier,
    weight: contribution.weight,
    created_at: contribution.created_at,
  }
}

function buildWikiPageIndex(pages: ExportableWikiPage[]): Array<Record<string, unknown>> {
  return pages.map((page) => ({
    slug: page.slug,
    entity_type: page.entity_type,
    title: page.title,
    generated_at: page.generated_at,
    updated_at: page.updated_at ?? null,
    unverified_count: page.unverified_count,
  }))
}

function buildConsensusIndex(records: ExportableConsolidatedCollection[]): Array<Record<string, unknown>> {
  return records.map((record) => ({
    collection_slug: record.collection_slug,
    scope: record.scope,
    confidence: record.confidence,
    completeness_score: record.completeness.score,
    filled_fields: record.completeness.filled,
    total_fields: record.completeness.total,
  }))
}

function buildWikiPageMarkdown(page: ExportableWikiPage): string {
  const statusSummary = page.unverified_count > 0 ? "partial" : "supporting"
  const frontmatter = buildFrontmatter({
    slug: page.slug,
    entity_type: page.entity_type,
    generated_at: page.generated_at,
    updated_at: page.updated_at ?? null,
    unverified_count: page.unverified_count,
    status_summary: statusSummary,
    source_event_ids: page.source_event_ids,
  })

  const sections = page.sections.length > 0
    ? page.sections.map((section) => {
      const lines = [`## ${section.heading}`, "", section.body]
      if (section.source_event_ids.length > 0) {
        lines.push("", `Source events: ${section.source_event_ids.join(", ")}`)
      }
      if (section.unverified_claims) {
        lines.push("Verification: contains unverified claims.")
      }
      return lines.join("\n")
    }).join("\n\n")
    : "No sections were present in this wiki page snapshot."

  const refs = page.cross_refs.length > 0
    ? `\n\nCross references: ${page.cross_refs.join(", ")}`
    : ""

  return `${frontmatter}\n# ${page.title}\n\n${page.summary}\n\n${sections}${refs}\n`
}

function buildConsensusMarkdown(record: ExportableConsolidatedCollection): string {
  const frontmatter = buildFrontmatter({
    collection_slug: record.collection_slug,
    scope: record.scope,
    confidence: record.confidence,
    completeness_score: record.completeness.score,
    completeness_filled: record.completeness.filled,
    completeness_total: record.completeness.total,
    sample_inscription_id: record.sample_inscription_id ?? null,
  })

  const narrative = Object.values(record.narrative)
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((field) => {
      const lines = [`## ${field.field}`, "", `Status: ${field.status}`]
      lines.push(`Resolved by tier: ${field.resolved_by_tier}`)
      lines.push(`Canonical value: ${field.canonical_value ?? "None"}`)
      if (field.contributions.length > 0) {
        lines.push("", "Public contributions:")
        for (const contribution of field.contributions) {
          lines.push(`- [${contribution.og_tier}] ${contribution.value} (${contribution.created_at})`)
        }
      }
      return lines.join("\n")
    })
    .join("\n\n")

  const factual = record.factual
    ? [
      "## Factual context",
      "",
      `Supply: ${record.factual.supply ?? "Unknown"}`,
      `First seen: ${record.factual.first_seen ?? "Unknown"}`,
      `Last seen: ${record.factual.last_seen ?? "Unknown"}`,
    ].join("\n")
    : "## Factual context\n\nNo factual context was available in this snapshot."

  return `${frontmatter}\n# Consensus for ${record.collection_slug}\n\nThis file captures public community consensus and keeps factual context separate.\n\n${factual}\n\n${narrative}\n`
}

function buildReadme(snapshot: WikiExportSnapshot): string {
  return [
    "# Ordinal Mind Wiki Export",
    "",
    "This archive is a public snapshot of the Ordinal Mind wiki.",
    "",
    "## Structure",
    "",
    "- `manifest.json`: export metadata, counts, exclusions, and warnings.",
    "- `wiki-pages/`: public wiki page snapshots in JSON and Markdown.",
    "- `consensus/`: consolidated public community consensus in JSON and Markdown.",
    "- `sources/raw-events.json`: raw public events referenced by exported pages.",
    "",
    "## Truth model",
    "",
    "- Public data only.",
    "- `canonical`, `draft`, and `disputed` statuses are preserved explicitly.",
    "- `unverified_count` and `unverified_claims` remain visible where relevant.",
    "- No private moderation or identity fields are included.",
    "",
    "## Counts",
    "",
    `- Wiki pages: ${snapshot.manifest.counts.wiki_pages}`,
    `- Consensus records: ${snapshot.manifest.counts.consensus_records}`,
    `- Referenced raw events: ${snapshot.manifest.counts.raw_events}`,
    "",
  ].join("\n")
}

function buildFrontmatter(values: Record<string, unknown>): string {
  const lines = ["---"]
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}: ${yamlValue(value)}`)
  }
  lines.push("---", "")
  return lines.join("\n")
}

function yamlValue(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return `[${value.map((item) => yamlValue(item)).join(", ")}]`
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(String(value))
}

function slugToFilename(slug: string): string {
  return slug
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "wiki-export"
}

function resolveConsensusScope(slug: string): string {
  const separatorIndex = slug.indexOf(":")
  if (separatorIndex === -1) return "collection"
  return slug.slice(0, separatorIndex) || "collection"
}

function buildExportFilename(isoString: string): string {
  const day = isoString.slice(0, 10)
  return `ordinal-mind-wiki-export-${day}.zip`
}

function buildContentDisposition(filename: string): string {
  const asciiFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A")
}

function sortSections(sections: ExportableWikiSection[]): ExportableWikiSection[] {
  return [...sections]
    .map((section) => ({
      ...section,
      source_event_ids: sortStrings(section.source_event_ids ?? []),
    }))
    .sort((a, b) => a.heading.localeCompare(b.heading) || a.body.localeCompare(b.body))
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForJson(value), null, 2)
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForJson(item))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForJson(nested)])
    )
  }
  return value
}

function jsonError(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
