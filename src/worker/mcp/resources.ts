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
