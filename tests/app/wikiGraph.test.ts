import { describe, expect, it } from "vitest"
import {
  buildEdgeInspector,
  buildNodeInspector,
  buildTreeNodeLayoutOptions,
  createDefaultWikiGraphFilters,
  filterWikiGraphPayload,
  toCytoscapeElements,
} from "../../src/app/lib/wikiGraph"
import type { WikiGraphPayload } from "../../src/app/lib/types"

const payload: WikiGraphPayload = {
  collection_slug: "bitcoin-frogs",
  focus_node_id: "inscription:frog0001i0",
  nodes: [
    {
      id: "collection:bitcoin-frogs",
      kind: "collection",
      label: "Bitcoin Frogs",
      status: "canonical",
      description: "Collector-led frog lineage.",
      href: "/wiki/collection%3Abitcoin-frogs",
      metadata: { sample_inscription_id: "frog0001i0" },
    },
    {
      id: "field:bitcoin-frogs:founder",
      kind: "field",
      label: "Founder",
      status: "canonical",
      parent_id: "collection:bitcoin-frogs",
      description: "PepeMint",
      metadata: { field: "founder" },
    },
    {
      id: "claim:bitcoin-frogs:wc_founder",
      kind: "claim",
      label: "PepeMint",
      status: "canonical",
      parent_id: "field:bitcoin-frogs:founder",
      description: "PepeMint",
      metadata: { contribution_id: "wc_founder", og_tier: "og" },
    },
    {
      id: "inscription:frog0001i0",
      kind: "wiki_page",
      label: "Frog #1",
      status: "supporting",
      href: "/wiki/inscription%3Afrog0001i0",
      description: "Genesis frog page.",
      metadata: { slug: "inscription:frog0001i0", source_event_ids: ["ev_genesis_1"] },
    },
  ],
  edges: [
    {
      id: "field->claim",
      kind: "has_claim",
      source: "field:bitcoin-frogs:founder",
      target: "claim:bitcoin-frogs:wc_founder",
      status: "canonical",
      label: "og",
      metadata: { contribution_id: "wc_founder" },
    },
    {
      id: "collection->page",
      kind: "belongs_to_collection",
      source: "collection:bitcoin-frogs",
      target: "inscription:frog0001i0",
      status: "supporting",
      label: "collection wiki",
      metadata: {},
    },
  ],
  counts: {
    nodes: 4,
    edges: 2,
    fields: 1,
    claims: 1,
    wiki_pages: 1,
    source_events: 0,
    external_refs: 0,
  },
  warnings: [],
  generated_at: "2026-05-04T00:00:00.000Z",
  partial: false,
}

describe("wikiGraph client helpers", () => {
  it("maps graph payload into Cytoscape elements with node and edge metadata", () => {
    const elements = toCytoscapeElements(payload)
    expect(elements).toHaveLength(6)

    const claim = elements.find((element) => element.data.id === "claim:bitcoin-frogs:wc_founder")
    expect(claim?.classes).toContain("kind-claim")
    expect(claim?.data.parent).toBe("field:bitcoin-frogs:founder")

    const edge = elements.find((element) => element.data.id === "field->claim")
    expect(edge?.data.source).toBe("field:bitcoin-frogs:founder")
    expect(edge?.classes).toContain("status-canonical")
  })

  it("derives filtered payload counts and keeps only connected edges", () => {
    const filters = createDefaultWikiGraphFilters()
    const filtered = filterWikiGraphPayload(payload, {
      ...filters,
      search: "frog #1",
    })

    expect(filtered.nodes.map((node) => node.id)).toEqual(["inscription:frog0001i0"])
    expect(filtered.edges).toHaveLength(0)
    expect(filtered.counts.nodes).toBe(1)
  })

  it("returns the full payload unchanged when all filters are active", () => {
    const filters = createDefaultWikiGraphFilters()
    const filtered = filterWikiGraphPayload(payload, filters)

    expect(filtered.edges).toEqual(payload.edges)
    expect(filtered.focus_node_id).toBe(payload.focus_node_id)
    expect(filtered.nodes.map((node) => node.id)).toEqual(payload.nodes.map((node) => node.id))
    expect(filtered.nodes.every((node) => node.parent_id === null)).toBe(true)
  })

  it("formats node and edge inspector data for the modal", () => {
    const nodeInspector = buildNodeInspector(payload.nodes[0])
    expect(nodeInspector.title).toBe("Bitcoin Frogs")
    expect(nodeInspector.href).toBe("/wiki/collection%3Abitcoin-frogs")
    expect(nodeInspector.details.some((detail) => detail.label === "Sample Inscription Id")).toBe(true)

    const edgeInspector = buildEdgeInspector(payload.edges[0])
    expect(edgeInspector.subtitle).toContain("Has Claim")
    expect(edgeInspector.details[0]).toEqual({ label: "Source", value: "field:bitcoin-frogs:founder" })
  })

  it("assigns tree layout partitions to separate collection and inscription branches", () => {
    expect(buildTreeNodeLayoutOptions({ kind: "collection" })).toEqual({
      "elk.partitioning.partition": 0,
      "elk.layered.layering.layerConstraint": "FIRST",
    })
    expect(buildTreeNodeLayoutOptions({ kind: "field", scope: "collection" })).toEqual({
      "elk.partitioning.partition": 1,
    })
    expect(buildTreeNodeLayoutOptions({ kind: "wiki_page", entity_type: "inscription" })).toEqual({
      "elk.partitioning.partition": 2,
    })
    expect(buildTreeNodeLayoutOptions({ kind: "source_event" })).toEqual({
      "elk.partitioning.partition": 3,
    })
  })
})
