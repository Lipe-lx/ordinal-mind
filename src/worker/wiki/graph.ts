import type {
  ConsolidatedCollection,
  ConsolidatedField,
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphPayload,
  WikiGraphStatus,
} from "../../app/lib/types"
import type { Env } from "../index"
import { buildConsolidation } from "./consolidate"
import { CANONICAL_FIELDS, isFieldAllowedForSlug } from "./contribute"
import { buildCollectionSlugAliases, normalizeCollectionSlugInput, toCollectionWikiPageSlug } from "./slugAliases"

const MAX_SOURCE_EVENT_NODES = 24

const TIER_WEIGHTS: Record<string, number> = {
  genesis: 4,
  og: 3,
  community: 2,
  anon: 1,
}

interface BuildCollectionGraphOptions {
  focus?: string | null
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
  view_count: number
  updated_at: string
}

interface ContributionRow {
  id: string
  field: string
  value: string
  confidence: string
  verifiable: number
  contributor_id: string | null
  og_tier: string
  status: string
  created_at: string
}

interface RawEventRow {
  id: string
  inscription_id: string
  event_type: string
  timestamp: string
  block_height: number
  source_type: string
  source_ref: string
  description: string
  metadata_json: string
}

interface ParsedWikiPage {
  slug: string
  entity_type: string
  title: string
  summary: string
  sections: Array<Record<string, unknown>>
  cross_refs: string[]
  source_event_ids: string[]
  generated_at: string
  byok_provider: string
  unverified_count: number
  view_count: number
  updated_at: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}

export async function handleCollectionGraph(
  slug: string,
  env: Env,
  options: BuildCollectionGraphOptions = {}
): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable", phase: "fail_soft" }, 503)
  }

  try {
    const data = await buildCollectionGraph(slug, env, options)
    return json({ ok: true, data })
  } catch (error) {
    console.error("[WikiGraph] Error:", error)
    return json({ ok: false, error: "wiki_graph_build_failed", phase: "fail_soft" }, 500)
  }
}

export async function buildCollectionGraph(
  slug: string,
  env: Env,
  options: BuildCollectionGraphOptions = {}
): Promise<WikiGraphPayload> {
  if (!env.DB) {
    throw new Error("wiki_db_unavailable")
  }

  const normalizedSlug = normalizeCollectionSlugInput(slug)
  const aliasSlugs = buildCollectionSlugAliases(normalizedSlug)
  const aliasWikiSlugs = new Set(aliasSlugs.map(toCollectionWikiPageSlug))
  const collectionWikiSlug = toCollectionWikiPageSlug(normalizedSlug)

  const normalizedFocus = options.focus?.startsWith("inscription:") 
    ? options.focus.slice("inscription:".length) 
    : options.focus

  const contributionSlugs = [...aliasSlugs]
  if (normalizedFocus && /^[a-f0-9]{64}i[0-9]+$/i.test(normalizedFocus) && !contributionSlugs.includes(normalizedFocus)) {
    contributionSlugs.push(normalizedFocus)
  }
  const contribPlaceholders = contributionSlugs.map(() => "?").join(", ")

  const [consolidated, pageRows, contributionRows] = await Promise.all([
    buildConsolidation(normalizedSlug, env),
    env.DB.prepare(`
      SELECT slug, entity_type, title, summary, sections_json,
             cross_refs_json, source_event_ids_json, generated_at,
             byok_provider, unverified_count, view_count, updated_at
      FROM wiki_pages
    `).all<WikiPageRow>(),
    env.DB.prepare(`
      SELECT id, field, value, confidence, verifiable,
             contributor_id, og_tier, status, created_at
      FROM wiki_contributions
      WHERE collection_slug IN (${contribPlaceholders})
        AND status IN ('published', 'quarantine')
    `)
      .bind(...contributionSlugs)
      .all<ContributionRow>(),
  ])

  const allPages = (pageRows.results ?? []).map(parseWikiPage)
  const existingPages = new Map(allPages.map((page) => [page.slug, page] as const))
  const collectionPage = [collectionWikiSlug, ...aliasWikiSlugs]
    .map((candidate) => existingPages.get(candidate))
    .find((page): page is ParsedWikiPage => Boolean(page)) ?? null
  const collectionPages = allPages
    .filter((page) => page.entity_type === "inscription")
    .filter((page) => page.cross_refs.some((ref) => aliasWikiSlugs.has(ref)))
    .sort(sortWikiPages)

  const warnings: string[] = []
  if (!collectionPage) {
    warnings.push("No collection wiki page exists yet — graph built from consensus data and linked inscription pages.")
  }
  if (collectionPages.length === 0) {
    warnings.push("No inscription wiki pages are linked to this collection yet.")
  }

  const nodes: WikiGraphNode[] = []
  const edges: WikiGraphEdge[] = []
  const nodeIndex = new Set<string>()
  const edgeIndex = new Set<string>()

  const addNode = (node: WikiGraphNode) => {
    if (nodeIndex.has(node.id)) return
    nodeIndex.add(node.id)
    nodes.push(node)
  }

  const addEdge = (edge: WikiGraphEdge) => {
    if (edgeIndex.has(edge.id)) return
    edgeIndex.add(edge.id)
    edges.push(edge)
  }

  const rootNodeId = collectionWikiSlug
  addNode(buildCollectionRootNode(consolidated, collectionPage, rootNodeId))

  const allowedFields = CANONICAL_FIELDS.filter(f => isFieldAllowedForSlug(f, normalizedSlug))
  for (const field of allowedFields) {
    const consolidatedField = consolidated.narrative[field]
    const fieldNodeId = buildFieldNodeId(normalizedSlug, field)
    addNode({
      id: fieldNodeId,
      kind: "field",
      label: formatFieldLabel(field),
      status: resolveFieldStatus(consolidatedField),
      parent_id: rootNodeId,
      description: consolidatedField?.canonical_value ?? "No published value yet.",
      metadata: {
        field,
        resolved_by_tier: consolidatedField?.resolved_by_tier ?? "none",
        contribution_count: consolidatedField?.contributions.length ?? 0,
        canonical_value: consolidatedField?.canonical_value,
      },
    })
    addEdge({
      id: `${rootNodeId}->${fieldNodeId}:has_field`,
      kind: "has_field",
      source: rootNodeId,
      target: fieldNodeId,
      status: resolveFieldStatus(consolidatedField),
      label: "field",
      metadata: { field },
    })
  }

  const contributionsByField = new Map<string, ContributionRow[]>()
  for (const row of contributionRows.results ?? []) {
    const list = contributionsByField.get(row.field) ?? []
    list.push(row)
    contributionsByField.set(row.field, list)
  }

  for (const field of allowedFields) {
    const fieldContributions = (contributionsByField.get(field) ?? []).slice().sort(sortContributions)
    const fieldState = consolidated.narrative[field]
    const fieldNodeId = buildFieldNodeId(normalizedSlug, field)

    for (const row of fieldContributions) {
      const claimNodeId = buildClaimNodeId(normalizedSlug, row)
      const claimStatus = resolveClaimStatus(fieldState, row)
      addNode({
        id: claimNodeId,
        kind: "claim",
        label: truncateLabel(row.value, 96),
        status: claimStatus,
        parent_id: fieldNodeId,
        description: row.value,
        metadata: {
          field,
          contribution_id: row.id,
          og_tier: row.og_tier,
          confidence: row.confidence,
          verifiable: Boolean(row.verifiable),
          contributor_id: row.contributor_id,
          created_at: row.created_at,
          moderation_status: row.status,
        },
      })
      addEdge({
        id: `${fieldNodeId}->${claimNodeId}:has_claim`,
        kind: "has_claim",
        source: fieldNodeId,
        target: claimNodeId,
        status: claimStatus,
        label: row.og_tier,
        metadata: {
          field,
          contribution_id: row.id,
        },
      })
    }
  }

  const pageEventIds = new Map<string, string[]>()
  for (const page of collectionPages) {
    const pageStatus: WikiGraphStatus = page.unverified_count > 0 ? "partial" : "supporting"
    addNode({
      id: page.slug,
      kind: "wiki_page",
      label: page.title,
      status: pageStatus,
      href: `/wiki/${encodeURIComponent(page.slug)}`,
      description: page.summary,
      metadata: {
        slug: page.slug,
        entity_type: page.entity_type,
        byok_provider: page.byok_provider,
        cross_refs: page.cross_refs,
        source_event_ids: page.source_event_ids,
        unverified_count: page.unverified_count,
        updated_at: page.updated_at,
        generated_at: page.generated_at,
      },
    })
    addEdge({
      id: `${page.slug}->${rootNodeId}:belongs_to_collection`,
      kind: "belongs_to_collection",
      source: page.slug,
      target: rootNodeId,
      status: pageStatus,
      label: "collection wiki",
      metadata: { slug: page.slug },
    })
    pageEventIds.set(page.slug, page.source_event_ids)
  }

  const linkedPages = new Set<string>(collectionPages.map((page) => page.slug))
  let unresolvedRefCount = 0
  for (const page of collectionPages) {
    for (const ref of page.cross_refs) {
      if (aliasWikiSlugs.has(ref)) continue

      const existing = existingPages.get(ref)
      if (existing) {
        if (!linkedPages.has(ref)) {
          linkedPages.add(ref)
          addNode({
            id: ref,
            kind: "wiki_page",
            label: existing.title,
            status: existing.unverified_count > 0 ? "partial" : "supporting",
            href: `/wiki/${encodeURIComponent(ref)}`,
            description: existing.summary,
            metadata: {
              slug: existing.slug,
              entity_type: existing.entity_type,
              cross_refs: existing.cross_refs,
              source_event_ids: existing.source_event_ids,
              linked_reference: true,
              updated_at: existing.updated_at,
            },
          })
        }

        addEdge({
          id: `${page.slug}->${ref}:links_to`,
          kind: "links_to",
          source: page.slug,
          target: ref,
          status: existing.unverified_count > 0 ? "partial" : "supporting",
          label: "wiki link",
          metadata: { from: page.slug, to: ref },
        })
        continue
      }

      unresolvedRefCount += 1
      const externalNodeId = `external:${ref}`
      addNode({
        id: externalNodeId,
        kind: "external_ref",
        label: ref,
        status: "partial",
        description: "This wiki reference does not resolve to an existing page.",
        metadata: {
          slug: ref,
          unresolved: true,
        },
      })
      addEdge({
        id: `${page.slug}->${externalNodeId}:links_to`,
        kind: "links_to",
        source: page.slug,
        target: externalNodeId,
        status: "partial",
        label: "unresolved link",
        metadata: { from: page.slug, to: ref },
      })
    }
  }

  if (unresolvedRefCount > 0) {
    warnings.push(`${unresolvedRefCount} wiki reference(s) could not be resolved and are shown as partial links.`)
  }

  const uniqueEventIds = Array.from(
    new Set(collectionPages.flatMap((page) => page.source_event_ids))
  )

  if (uniqueEventIds.length > MAX_SOURCE_EVENT_NODES) {
    warnings.push("Source event nodes were bundled to keep the graph readable.")
    buildBundledEventNodes({
      pages: collectionPages,
      addNode,
      addEdge,
    })
  } else if (uniqueEventIds.length > 0) {
    const rawEvents = await fetchRawEventsById(uniqueEventIds, env)
    const rawEventsById = new Map(rawEvents.map((event) => [event.id, event] as const))
    const missingEventIds = uniqueEventIds.filter((id) => !rawEventsById.has(id))

    for (const event of rawEvents.sort(sortRawEvents)) {
      addNode({
        id: event.id,
        kind: "source_event",
        label: buildEventLabel(event),
        status: "supporting",
        description: event.description,
        metadata: {
          inscription_id: event.inscription_id,
          event_type: event.event_type,
          timestamp: event.timestamp,
          block_height: event.block_height,
          source_type: event.source_type,
          source_ref: event.source_ref,
          metadata_json: event.metadata_json,
        },
      })
    }

    for (const [pageSlug, eventIds] of pageEventIds.entries()) {
      for (const eventId of eventIds) {
        if (!rawEventsById.has(eventId)) continue
        addEdge({
          id: `${pageSlug}->${eventId}:cites_event`,
          kind: "cites_event",
          source: pageSlug,
          target: eventId,
          status: "supporting",
          label: "evidence",
          metadata: { page_slug: pageSlug, event_id: eventId },
        })
      }
    }

    if (missingEventIds.length > 0) {
      warnings.push(`${missingEventIds.length} cited source event(s) were not found in raw Chronicle storage.`)
    }
  }

  const focusNodeId = resolveFocusNodeId({
    requestedFocus: options.focus ?? null,
    sampleInscriptionId: consolidated.sample_inscription_id,
    nodeIds: nodeIndex,
    fallback: collectionPages[0]?.slug ?? rootNodeId,
  })

  return {
    collection_slug: slug,
    focus_node_id: focusNodeId,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      fields: nodes.filter((node) => node.kind === "field").length,
      claims: nodes.filter((node) => node.kind === "claim").length,
      wiki_pages: nodes.filter((node) => node.kind === "wiki_page").length,
      source_events: nodes.filter((node) => node.kind === "source_event").length,
      external_refs: nodes.filter((node) => node.kind === "external_ref").length,
    },
    warnings,
    generated_at: new Date().toISOString(),
    partial: warnings.length > 0,
  }
}

function buildCollectionRootNode(
  consolidated: ConsolidatedCollection,
  collectionPage: ParsedWikiPage | null,
  id: string
): WikiGraphNode {
  const completenessPct = Math.round(consolidated.completeness.score * 100)
  const confidencePct = Math.round(consolidated.confidence * 100)
  const supply = consolidated.factual?.supply ?? null
  const summary = collectionPage?.summary
    ?? `Consensus coverage: ${consolidated.completeness.filled}/${consolidated.completeness.total} fields.`

  const displayName = collectionPage?.title 
    ?? consolidated.narrative["name"]?.canonical_value 
    ?? consolidated.collection_slug

  return {
    id,
    kind: "collection",
    label: displayName,
    status: collectionPage ? "canonical" : "partial",
    href: collectionPage ? `/wiki/${encodeURIComponent(collectionPage.slug)}` : null,
    description: summary,
    metadata: {
      collection_slug: consolidated.collection_slug,
      completeness: consolidated.completeness,
      confidence: consolidated.confidence,
      confidence_percent: confidencePct,
      completeness_percent: completenessPct,
      supply,
      first_seen: consolidated.factual?.first_seen ?? null,
      last_seen: consolidated.factual?.last_seen ?? null,
      sample_inscription_id: consolidated.sample_inscription_id,
      gaps: consolidated.gaps,
    },
  }
}

function buildBundledEventNodes(params: {
  pages: ParsedWikiPage[]
  addNode: (node: WikiGraphNode) => void
  addEdge: (edge: WikiGraphEdge) => void
}): void {
  for (const page of params.pages) {
    if (page.source_event_ids.length === 0) continue
    const bundleNodeId = `bundle:${page.slug}`
    params.addNode({
      id: bundleNodeId,
      kind: "source_event",
      label: `${page.source_event_ids.length} cited source event${page.source_event_ids.length === 1 ? "" : "s"}`,
      status: "supporting",
      description: "Event bundle used to keep this collection graph readable.",
      metadata: {
        page_slug: page.slug,
        bundled: true,
        source_event_ids: page.source_event_ids,
      },
    })
    params.addEdge({
      id: `${page.slug}->${bundleNodeId}:cites_event`,
      kind: "cites_event",
      source: page.slug,
      target: bundleNodeId,
      status: "supporting",
      label: "evidence bundle",
      metadata: {
        page_slug: page.slug,
        bundled: true,
        source_event_ids: page.source_event_ids,
      },
    })
  }
}

async function fetchRawEventsById(ids: string[], env: Env): Promise<RawEventRow[]> {
  if (!env.DB || ids.length === 0) return []

  const placeholders = ids.map(() => "?").join(", ")
  const rows = await env.DB.prepare(`
    SELECT id, inscription_id, event_type, timestamp, block_height,
           source_type, source_ref, description, metadata_json
    FROM raw_chronicle_events
    WHERE id IN (${placeholders})
  `)
    .bind(...ids)
    .all<RawEventRow>()

  return rows.results ?? []
}

function parseWikiPage(row: WikiPageRow): ParsedWikiPage {
  return {
    slug: row.slug,
    entity_type: row.entity_type,
    title: row.title,
    summary: row.summary,
    sections: safeJsonParse(row.sections_json, []),
    cross_refs: safeJsonParse(row.cross_refs_json, []),
    source_event_ids: safeJsonParse(row.source_event_ids_json, []),
    generated_at: row.generated_at,
    byok_provider: row.byok_provider,
    unverified_count: Number(row.unverified_count ?? 0),
    view_count: Number(row.view_count ?? 0),
    updated_at: row.updated_at,
  }
}

function resolveFieldStatus(field: ConsolidatedField | undefined): WikiGraphStatus {
  if (!field) return "partial"
  if (field.status === "canonical") return "canonical"
  if (field.status === "disputed") return "disputed"
  return "draft"
}

function resolveClaimStatus(field: ConsolidatedField | undefined, contribution: ContributionRow): WikiGraphStatus {
  if (!field) return "partial"
  if (field.status === "disputed") return "disputed"
  if (field.status === "draft" || contribution.status === "quarantine") return "draft"
  if (field.canonical_value && normalizeValue(field.canonical_value) === normalizeValue(contribution.value)) {
    return "canonical"
  }
  return "supporting"
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

function buildFieldNodeId(slug: string, field: string): string {
  return `field:${slug}:${field}`
}

function buildClaimNodeId(slug: string, row: ContributionRow): string {
  return `claim:${slug}:${row.id}`
}

function formatFieldLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function truncateLabel(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function buildEventLabel(event: RawEventRow): string {
  const date = formatDate(event.timestamp)
  return `${formatFieldLabel(event.event_type)}${date ? ` · ${date}` : ""}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

function sortContributions(a: ContributionRow, b: ContributionRow): number {
  const weightDelta = (TIER_WEIGHTS[b.og_tier] ?? 0) - (TIER_WEIGHTS[a.og_tier] ?? 0)
  if (weightDelta !== 0) return weightDelta

  const createdDelta = Date.parse(b.created_at) - Date.parse(a.created_at)
  if (createdDelta !== 0) return createdDelta

  return a.value.localeCompare(b.value)
}

function sortWikiPages(a: ParsedWikiPage, b: ParsedWikiPage): number {
  const timeDelta = Date.parse(b.updated_at || b.generated_at) - Date.parse(a.updated_at || a.generated_at)
  if (timeDelta !== 0) return timeDelta
  return a.slug.localeCompare(b.slug)
}

function sortRawEvents(a: RawEventRow, b: RawEventRow): number {
  const timeDelta = Date.parse(a.timestamp) - Date.parse(b.timestamp)
  if (timeDelta !== 0) return timeDelta
  return a.id.localeCompare(b.id)
}

function resolveFocusNodeId(params: {
  requestedFocus: string | null
  sampleInscriptionId: string | null
  nodeIds: Set<string>
  fallback: string
}): string {
  const requestedFocus = params.requestedFocus?.trim()
  if (requestedFocus && params.nodeIds.has(requestedFocus)) {
    return requestedFocus
  }

  const sampleSlug = params.sampleInscriptionId ? `inscription:${params.sampleInscriptionId}` : null
  if (sampleSlug && params.nodeIds.has(sampleSlug)) {
    return sampleSlug
  }

  return params.fallback
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
