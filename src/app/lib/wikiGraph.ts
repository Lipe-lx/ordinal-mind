import type {
  WikiGraphAvailableField,
  WikiGraphEdge,
  WikiGraphFieldScope,
  WikiGraphNode,
  WikiGraphNodeKind,
  WikiGraphPayload,
  WikiGraphStatus,
} from "./types"
import type { CanonicalField } from "./byok/wikiCompleteness"

export const WIKI_GRAPH_NODE_KINDS: WikiGraphNodeKind[] = [
  "collection",
  "field",
  "claim",
  "wiki_page",
  "source_event",
  "external_ref",
]

export const WIKI_GRAPH_STATUSES: WikiGraphStatus[] = [
  "canonical",
  "draft",
  "disputed",
  "supporting",
  "partial",
  "neutral",
]

export interface WikiGraphFilters {
  search: string
  nodeKinds: WikiGraphNodeKind[]
  statuses: WikiGraphStatus[]
  viewMode: "tree" | "neural"
}

export interface CytoscapeElementDefinition {
  data: Record<string, unknown>
  group?: "nodes" | "edges"
  classes?: string
}

export interface WikiGraphInspectorDetail {
  label: string
  value: string
}

export interface WikiGraphInspectorAction {
  type: "contribute"
  label: string
  field: CanonicalField
  targetSlug: string
  initialValue?: string
}

export interface WikiGraphInspectorSectionItem {
  label: string
  value?: string
  meta?: string
  status?: WikiGraphStatus | string
  action?: WikiGraphInspectorAction
}

export interface WikiGraphInspectorSection {
  title: string
  items: WikiGraphInspectorSectionItem[]
}

export interface WikiGraphInspectorData {
  title: string
  subtitle: string
  description: string | null
  href: string | null
  primary_action?: WikiGraphInspectorAction
  sections: WikiGraphInspectorSection[]
  details: WikiGraphInspectorDetail[]
}

export function createDefaultWikiGraphFilters(): WikiGraphFilters {
  return {
    search: "",
    nodeKinds: [...WIKI_GRAPH_NODE_KINDS],
    statuses: [...WIKI_GRAPH_STATUSES],
    viewMode: "neural",
  }
}

export async function fetchWikiGraph(
  collectionSlug: string,
  options: { focus?: string | null } = {}
): Promise<WikiGraphPayload | null> {
  if (!collectionSlug) return null

  const params = new URLSearchParams()
  if (options.focus) params.set("focus", options.focus)
  const suffix = params.toString() ? `?${params.toString()}` : ""

  try {
    const response = await fetch(`/api/wiki/collection/${encodeURIComponent(collectionSlug)}/graph${suffix}`)
    if (!response.ok) return null

    const payload = await response.json() as { ok?: boolean; data?: WikiGraphPayload }
    if (!payload.ok || !payload.data) return null
    return payload.data
  } catch {
    return null
  }
}

export function toCytoscapeElements(payload: WikiGraphPayload): CytoscapeElementDefinition[] {
  // Pre-compute degree for each node so Cytoscape styles can use mapData(degree, ...)
  const degreeMap = new Map<string, number>()
  for (const edge of payload.edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
  }

  const nodeElements = payload.nodes.map((node) => ({
    group: "nodes" as const,
    data: {
      ...node.metadata,
      id: node.id,
      label: node.label,
      kind: node.kind,
      status: node.status,
      parent: node.parent_id ?? undefined,
      href: node.href ?? undefined,
      description: node.description ?? undefined,
      degree: degreeMap.get(node.id) ?? 0,
    },
    classes: `kind-${node.kind} status-${node.status}`,
  }))

  const edgeElements = payload.edges.map((edge) => ({
    group: "edges" as const,
    data: {
      ...edge.metadata,
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label ?? undefined,
      kind: edge.kind,
      status: edge.status,
    },
    classes: `kind-${edge.kind} status-${edge.status}`,
  }))

  return [...nodeElements, ...edgeElements]
}

export function filterWikiGraphPayload(payload: WikiGraphPayload, filters: WikiGraphFilters): WikiGraphPayload {
  const search = filters.search.trim().toLowerCase()
  const normalizedKinds = Array.from(new Set(filters.nodeKinds))
  const normalizedStatuses = Array.from(new Set(filters.statuses))
  const allowedKinds = new Set(normalizedKinds)
  const allowedStatuses = new Set(normalizedStatuses)



  const nodes = payload.nodes.filter((node) => {
    if (!allowedKinds.has(node.kind)) return false
    if (!allowedStatuses.has(node.status)) return false
    if (!search) return true
    return matchesSearch(node, search)
  })

  const visibleNodeIds = new Set(nodes.map((n) => n.id))

  // Flatten hierarchy visually to avoid compound node rendering crashes/bugs.
  // We rely on edges (has_field, has_claim) to represent the hierarchy in the layout.
  const processedNodes = nodes.map((node) => ({
    ...node,
    parent_id: null,
  }))

  const edges = payload.edges.filter((edge) => {
    if (!allowedStatuses.has(edge.status)) return false
    return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  })

  const filteredFocus = payload.focus_node_id && visibleNodeIds.has(payload.focus_node_id)
    ? payload.focus_node_id
    : processedNodes[0]?.id ?? null

  return {
    ...payload,
    focus_node_id: filteredFocus,
    nodes: processedNodes,
    edges,
    counts: {
      nodes: processedNodes.length,
      edges: edges.length,
      fields: processedNodes.filter((node) => node.kind === "field").length,
      claims: processedNodes.filter((node) => node.kind === "claim").length,
      wiki_pages: processedNodes.filter((node) => node.kind === "wiki_page").length,
      source_events: processedNodes.filter((node) => node.kind === "source_event").length,
      external_refs: processedNodes.filter((node) => node.kind === "external_ref").length,
    },
  }
}

export function buildNodeInspector(node: WikiGraphNode): WikiGraphInspectorData {
  const sections = buildInspectorSections(node)
  return {
    title: node.label,
    subtitle: `${formatKindLabel(node.kind)} · ${formatStatusLabel(node.status)}`,
    description: node.description ?? null,
    href: node.href ?? null,
    primary_action: resolvePrimaryAction(node, sections),
    sections,
    details: formatInspectorDetails(node.metadata),
  }
}

export function buildEdgeInspector(edge: WikiGraphEdge): WikiGraphInspectorData {
  return {
    title: edge.label ?? formatKindLabel(edge.kind),
    subtitle: `${formatKindLabel(edge.kind)} · ${formatStatusLabel(edge.status)}`,
    description: null,
    href: null,
    sections: [],
    details: [
      { label: "Source", value: edge.source },
      { label: "Target", value: edge.target },
      ...formatInspectorDetails(edge.metadata),
    ],
  }
}

export function buildTreeNodeLayoutOptions(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const kind = typeof data.kind === "string" ? data.kind : null
  const scope = typeof data.scope === "string" ? data.scope : null
  const entityType = typeof data.entity_type === "string" ? data.entity_type : null

  if (kind === "collection") {
    return {
      "elk.partitioning.partition": 0,
      "elk.layered.layering.layerConstraint": "FIRST",
    }
  }

  if (kind === "field" || kind === "claim") {
    return {
      "elk.partitioning.partition": scope === "inscription" ? 2 : 1,
    }
  }

  if (kind === "wiki_page") {
    return {
      "elk.partitioning.partition": entityType === "inscription" ? 2 : 1,
    }
  }

  if (kind === "source_event" || kind === "external_ref") {
    return {
      "elk.partitioning.partition": 3,
    }
  }

  return undefined
}

export function formatKindLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatStatusLabel(value: WikiGraphStatus): string {
  switch (value) {
    case "canonical":
      return "Canonical"
    case "draft":
      return "Draft"
    case "disputed":
      return "Disputed"
    case "supporting":
      return "Source-backed"
    case "partial":
      return "Partial"
    case "neutral":
      return "Neutral"
  }
}

function matchesSearch(node: WikiGraphNode, search: string): boolean {
  const haystack = [
    node.label,
    node.description ?? "",
    ...Object.values(node.metadata).map((value) => stringifyValue(value)),
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(search)
}

function formatInspectorDetails(metadata: Record<string, unknown>): WikiGraphInspectorDetail[] {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 8)
    .map(([key, value]) => ({
      label: formatKindLabel(key),
      value: stringifyValue(value),
    }))
}

function buildInspectorSections(node: WikiGraphNode): WikiGraphInspectorSection[] {
  if (node.kind === "collection" || isInscriptionWikiPage(node)) {
    const scope: WikiGraphFieldScope = node.kind === "collection" ? "collection" : "inscription"
    const targetSlug = resolveContributionTargetSlug(node)
    const gaps = parseGaps(node.metadata)
    const availableFields = parseAvailableFields(node.metadata)
    const sections: WikiGraphInspectorSection[] = []

    if (targetSlug && gaps.length > 0) {
      sections.push({
        title: "Missing Fields",
        items: gaps.map((field) => ({
          label: formatFieldLabel(field),
          value: "No contribution yet",
          meta: scope === "collection" ? "Collection gap" : "Inscription gap",
          status: "draft",
          action: {
            type: "contribute",
            label: `Fill ${formatFieldLabel(field)}`,
            field,
            targetSlug,
          },
        })),
      })
    }

    if (targetSlug && availableFields.length > 0) {
      sections.push({
        title: "Editable Fields",
        items: availableFields.map((item) => ({
          label: formatFieldLabel(item.field as CanonicalField),
          value: item.canonical_value ?? "Draft or disputed value",
          meta: `${formatStatusLabel(item.status as WikiGraphStatus)} · ${item.contribution_count} contribution${item.contribution_count === 1 ? "" : "s"}`,
          status: item.status,
          action: {
            type: "contribute",
            label: item.canonical_value ? `Edit ${formatFieldLabel(item.field as CanonicalField)}` : `Contribute to ${formatFieldLabel(item.field as CanonicalField)}`,
            field: item.field as CanonicalField,
            targetSlug,
            initialValue: item.canonical_value ?? "",
          },
        })),
      })
    }

    return sections
  }

  if (node.kind === "field") {
    const field = typeof node.metadata.field === "string" ? node.metadata.field as CanonicalField : null
    const targetSlug = resolveContributionTargetSlug(node)
    if (!field || !targetSlug) return []

    const hasContributions = Boolean(node.metadata.has_contributions)
    const canonicalValue = typeof node.metadata.canonical_value === "string" ? node.metadata.canonical_value : ""
    return [{
      title: "Contribution Action",
      items: [{
        label: hasContributions ? `Edit ${formatFieldLabel(field)}` : `Fill ${formatFieldLabel(field)}`,
        value: hasContributions ? (canonicalValue || "Draft or disputed value") : "No contribution yet",
        meta: hasContributions ? "Add a corrective or supporting contribution" : "Start the first draft contribution for this field",
        status: hasContributions ? node.status : "draft",
        action: {
          type: "contribute",
          label: hasContributions ? `Correct ${formatFieldLabel(field)}` : `Contribute to ${formatFieldLabel(field)}`,
          field,
          targetSlug,
          initialValue: canonicalValue,
        },
      }],
    }]
  }

  return []
}

function resolvePrimaryAction(node: WikiGraphNode, sections: WikiGraphInspectorSection[]): WikiGraphInspectorAction | undefined {
  if (node.kind === "field") {
    return sections[0]?.items[0]?.action
  }
  if (node.kind === "collection" || isInscriptionWikiPage(node)) {
    return sections.find((section) => section.title === "Missing Fields")?.items[0]?.action
      ?? sections.find((section) => section.title === "Editable Fields")?.items[0]?.action
  }
  return undefined
}

function resolveContributionTargetSlug(node: WikiGraphNode): string | null {
  if (typeof node.metadata.owner_slug === "string" && node.metadata.owner_slug) return node.metadata.owner_slug
  if (typeof node.metadata.collection_slug === "string" && node.metadata.collection_slug) return node.metadata.collection_slug
  if (typeof node.metadata.sample_inscription_id === "string" && node.metadata.sample_inscription_id) return node.metadata.sample_inscription_id
  if (typeof node.metadata.slug === "string" && node.metadata.slug.startsWith("inscription:")) {
    return node.metadata.slug.slice("inscription:".length)
  }
  return null
}

function parseGaps(metadata: Record<string, unknown>): CanonicalField[] {
  const gaps = metadata.gaps
  if (!Array.isArray(gaps)) return []
  return gaps.filter((value): value is CanonicalField => typeof value === "string")
}

function parseAvailableFields(metadata: Record<string, unknown>): WikiGraphAvailableField[] {
  const value = metadata.available_fields
  if (!Array.isArray(value)) return []
  return value.filter((item): item is WikiGraphAvailableField => {
    if (!item || typeof item !== "object") return false
    const record = item as Record<string, unknown>
    return typeof record.field === "string" && typeof record.scope === "string"
  })
}

function isInscriptionWikiPage(node: WikiGraphNode): boolean {
  return node.kind === "wiki_page" && node.metadata.entity_type === "inscription"
}

function formatFieldLabel(field: CanonicalField): string {
  return field
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => stringifyValue(item)).join(", ")
    return value.length > 3 ? `${preview}…` : preview
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
    return keys.length > 0 ? `${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}` : ""
  }
  return ""
}
