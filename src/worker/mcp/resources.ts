import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index"
import type { ChronicleEvent, EventType } from "../../app/lib/types"
import { resolveInput } from "../resolver"
import { cacheGet } from "../cache"
import { guardCollectionLinks, guardEventWindow, guardProvenanceDepth, serializeGuardedResource } from "./guards"
import { getConsolidatedSnapshot } from "../wiki/consolidateEndpoint"
import { buildCollectionGraph } from "../wiki/graph"
import { isInscriptionId } from "../wiki/contribute"

const KNOWN_EVENT_TYPES = new Set<EventType>([
  "genesis",
  "transfer",
  "sale",
  "social_mention",
  "collection_link",
  "recursive_ref",
  "sat_context",
  "trait_context",
])

function normalizeEventType(value: string): EventType {
  return KNOWN_EVENT_TYPES.has(value as EventType)
    ? (value as EventType)
    : "transfer"
}

function formatWikiMarkdown(slug: string, snapshot: Awaited<ReturnType<typeof getConsolidatedSnapshot>>): string {
  const lines: string[] = []
  lines.push(`# Collection Chronicle: ${slug}`)
  lines.push("")
  lines.push(`- Confidence: ${snapshot.data.confidence}`)
  lines.push(`- Completeness: ${snapshot.data.completeness.filled}/${snapshot.data.completeness.total} (${snapshot.data.completeness.score})`)
  lines.push(`- Cached: ${snapshot.cached ? "yes" : "no"}`)
  lines.push("")

  const narrative = snapshot.data.narrative
  for (const [field, value] of Object.entries(narrative)) {
    lines.push(`## ${field}`)
    lines.push("")
    lines.push(`- Status: ${value.status}`)
    lines.push(`- Resolved by: ${value.resolved_by_tier}`)
    if (value.canonical_value) {
      lines.push(`- Canonical: ${value.canonical_value}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function normalizePageLookupCandidates(slug: string): string[] {
  const trimmed = slug.trim()
  if (!trimmed) return []

  const candidates = [trimmed]
  if (trimmed.startsWith("collection:")) {
    candidates.push(trimmed.slice("collection:".length))
  } else {
    candidates.push(`collection:${trimmed}`)
  }
  if (isInscriptionId(trimmed) && !trimmed.startsWith("inscription:")) {
    candidates.push(`inscription:${trimmed}`)
  }
  return Array.from(new Set(candidates))
}

async function readWikiPageBySlug(rawSlug: string, env: Env): Promise<Record<string, unknown>> {
  if (!env.DB) {
    return { ok: false, error: "wiki_db_unavailable" }
  }

  let row: {
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
    view_count: number
    updated_at: string | null
  } | null = null

  for (const candidate of normalizePageLookupCandidates(rawSlug)) {
    row = await env.DB.prepare(`
      SELECT slug, entity_type, title, summary, sections_json,
             cross_refs_json, source_event_ids_json, generated_at,
             byok_provider, unverified_count, view_count, updated_at
      FROM wiki_pages
      WHERE slug = ?
      LIMIT 1
    `)
      .bind(candidate)
      .first<{
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
        view_count: number
        updated_at: string | null
      }>()
    if (row) break
  }

  if (!row) {
    return {
      ok: false,
      error: "wiki_page_not_found",
      slug: rawSlug,
    }
  }

  const shape = derivePageShapeStatus({
    summary: row.summary,
    byok_provider: row.byok_provider,
    sections_json: row.sections_json,
    source_event_ids_json: row.source_event_ids_json,
  })

  return {
    ok: true,
    publication_status: shape.publication_status,
    page: {
      slug: row.slug,
      entity_type: row.entity_type,
      title: row.title,
      summary: row.summary,
      sections: safeParse(row.sections_json, [] as Array<Record<string, unknown>>),
      cross_refs: safeParse(row.cross_refs_json, [] as string[]),
      source_event_ids: safeParse(row.source_event_ids_json, [] as string[]),
      generated_at: row.generated_at,
      byok_provider: row.byok_provider,
      unverified_count: Number(row.unverified_count ?? 0),
      view_count: Number(row.view_count ?? 0),
      updated_at: row.updated_at,
      publication_status: shape.publication_status,
      page_kind: shape.page_kind,
      is_seed: shape.is_seed,
    },
  }
}

async function readChronicleById(rawId: string, env: Env): Promise<Record<string, unknown>> {
  const resolved = await resolveInput(rawId)
  if (resolved.type !== "inscription") {
    return {
      ok: false,
      error: "inscription_id_required",
      detail: "Use inscription id or inscription number for chronicle://inscription/{id}",
    }
  }

  const id = resolved.value
  const cached = await cacheGet(env.CHRONICLES_KV, id)
  if (cached) {
    const events = guardEventWindow(guardProvenanceDepth(cached.events))
    return {
      ok: true,
      source: "chronicle_cache",
      inscription_id: id,
      meta: cached.meta,
      events,
      source_catalog: cached.source_catalog,
      cached_at: cached.cached_at,
      partial: events.length !== cached.events.length,
    }
  }

  if (!env.DB) {
    return {
      ok: false,
      source: "none",
      error: "chronicle_not_cached",
      detail: "No KV cache hit and DB unavailable.",
      partial: true,
    }
  }

  const rows = await env.DB.prepare(`
    SELECT id, event_type, timestamp, block_height, source_type, source_ref, description, metadata_json
    FROM raw_chronicle_events
    WHERE inscription_id = ?
    ORDER BY timestamp ASC
    LIMIT 200
  `)
    .bind(id)
    .all<{
      id: string
      event_type: string
      timestamp: string
      block_height: number
      source_type: string
      source_ref: string
      description: string
      metadata_json: string
    }>()

  const rawEvents: ChronicleEvent[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    block_height: row.block_height,
    event_type: normalizeEventType(row.event_type),
    source: {
      type: row.source_type === "onchain" ? "onchain" : "web",
      ref: row.source_ref,
    },
    description: row.description,
    metadata: safeParse(row.metadata_json, {} as Record<string, unknown>),
  }))

  const events = guardEventWindow(guardProvenanceDepth(rawEvents))

  return {
    ok: true,
    source: "raw_chronicle_events",
    inscription_id: id,
    events,
    event_count: events.length,
    partial: true,
    note: "No KV chronicle cache hit; returning factual event rows from D1.",
  }
}

async function readCollectionContext(slug: string, env: Env): Promise<Record<string, unknown>> {
  const consolidated = env.DB ? await getConsolidatedSnapshot(slug, env).catch(() => null) : null
  const graph = env.DB ? await buildCollectionGraph(slug, env).catch(() => null) : null

  return {
    ok: true,
    collection_slug: slug,
    consolidated: consolidated?.data ?? null,
    graph_meta: graph ? {
      total_nodes: graph.counts.nodes,
      total_edges: graph.counts.edges,
      wiki_pages: graph.counts.wiki_pages,
      warnings: guardCollectionLinks(graph.warnings),
    } : null,
    partial: !consolidated || !graph,
  }
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function isEmptyArrayPayload(raw: string | null | undefined): boolean {
  if (!raw) return true
  const parsed = safeParse(raw, null as unknown)
  return Array.isArray(parsed) && parsed.length === 0
}

function derivePageShapeStatus(input: {
  summary?: string | null
  byok_provider?: string | null
  sections_json?: string | null
  source_event_ids_json?: string | null
}): {
  publication_status: "seed" | "published"
  page_kind: "seed" | "editorial"
  is_seed: boolean
} {
  const isSeed = (input.byok_provider ?? "") === "system_seed"
    && (input.summary ?? "").trim().length === 0
    && isEmptyArrayPayload(input.sections_json)
    && isEmptyArrayPayload(input.source_event_ids_json)

  return {
    publication_status: isSeed ? "seed" : "published",
    page_kind: isSeed ? "seed" : "editorial",
    is_seed: isSeed,
  }
}

export function registerResources(server: McpServer, env: Env): void {
  server.registerResource(
    "chronicle-inscription",
    new ResourceTemplate("chronicle://inscription/{id}", { list: undefined }),
    { title: "Chronicle by inscription", description: "Factual chronology for a Bitcoin Ordinal inscription" },
    async (uri, { id }) => {
      const payload = await readChronicleById(String(id), env)
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: serializeGuardedResource(payload),
        }],
      }
    }
  )

  server.registerResource(
    "wiki-page",
    new ResourceTemplate("wiki://page/{slug}", { list: undefined }),
    { title: "Wiki page by slug", description: "Public wiki page payload for collection/inscription/artist/sat slugs" },
    async (uri, { slug }) => {
      const payload = await readWikiPageBySlug(String(slug), env)
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: serializeGuardedResource(payload),
        }],
      }
    }
  )

  server.registerResource(
    "wiki-collection",
    new ResourceTemplate("wiki://collection/{slug}", { list: undefined }),
    { title: "Collection wiki consensus", description: "Tier-weighted community consensus summary for a collection" },
    async (uri, { slug }) => {
      if (!env.DB) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: "# Wiki unavailable\n\nD1 binding not configured.",
          }],
        }
      }

      const snapshot = await getConsolidatedSnapshot(String(slug), env)
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/markdown",
          text: formatWikiMarkdown(String(slug), snapshot),
        }],
      }
    }
  )

  server.registerResource(
    "collection-context",
    new ResourceTemplate("collection://context/{slug}", { list: undefined }),
    { title: "Collection context", description: "Collection-level factual context with graph summary" },
    async (uri, { slug }) => {
      const normalized = String(slug)
      const context = await readCollectionContext(normalized, env)

      if (isInscriptionId(normalized)) {
        const chronicle = await readChronicleById(normalized, env)
        ;(context as Record<string, unknown>).inscription_context = {
          inscription_id: normalized,
          chronicle,
        }
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: serializeGuardedResource(context),
        }],
      }
    }
  )
}
