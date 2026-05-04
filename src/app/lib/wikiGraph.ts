import type {
  WikiGraphEdge,
  WikiGraphNode,
  WikiGraphNodeKind,
  WikiGraphPayload,
  WikiGraphStatus,
} from "./types"

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

export interface WikiGraphInspectorData {
  title: string
  subtitle: string
  description: string | null
  href: string | null
  details: WikiGraphInspectorDetail[]
}

export function createDefaultWikiGraphFilters(): WikiGraphFilters {
  return {
    search: "",
    nodeKinds: [...WIKI_GRAPH_NODE_KINDS],
    statuses: [...WIKI_GRAPH_STATUSES],
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
  const allowedKinds = new Set(filters.nodeKinds)
  const allowedStatuses = new Set(filters.statuses)

  const nodes = payload.nodes.filter((node) => {
    if (!allowedKinds.has(node.kind)) return false
    if (!allowedStatuses.has(node.status)) return false
    if (!search) return true
    return matchesSearch(node, search)
  })

  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  const edges = payload.edges.filter((edge) => {
    if (!allowedStatuses.has(edge.status)) return false
    return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  })

  const filteredFocus = payload.focus_node_id && visibleNodeIds.has(payload.focus_node_id)
    ? payload.focus_node_id
    : nodes[0]?.id ?? null

  return {
    ...payload,
    focus_node_id: filteredFocus,
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
  }
}

export function buildNodeInspector(node: WikiGraphNode): WikiGraphInspectorData {
  return {
    title: node.label,
    subtitle: `${formatKindLabel(node.kind)} · ${formatStatusLabel(node.status)}`,
    description: node.description ?? null,
    href: node.href ?? null,
    details: formatInspectorDetails(node.metadata),
  }
}

export function buildEdgeInspector(edge: WikiGraphEdge): WikiGraphInspectorData {
  return {
    title: edge.label ?? formatKindLabel(edge.kind),
    subtitle: `${formatKindLabel(edge.kind)} · ${formatStatusLabel(edge.status)}`,
    description: null,
    href: null,
    details: [
      { label: "Source", value: edge.source },
      { label: "Target", value: edge.target },
      ...formatInspectorDetails(edge.metadata),
    ],
  }
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

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).join(", ")
  if (value && typeof value === "object") return JSON.stringify(value)
  return ""
}
