import { describe, expect, it } from "vitest"
import type { Env } from "../../src/worker/index"
import { buildCollectionGraph } from "../../src/worker/wiki/graph"

type Row = Record<string, unknown>

class GraphTestDatabase {
  rawEvents: Row[] = []
  wikiPages: Row[] = []
  wikiContributions: Row[] = []

  prepare(sql: string): GraphTestStatement {
    return new GraphTestStatement(this, sql)
  }
}

class GraphTestStatement {
  private params: unknown[] = []

  constructor(
    private db: GraphTestDatabase,
    private sql: string
  ) {}

  bind(...params: unknown[]): GraphTestStatement {
    this.params = params
    return this
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.select() as T[] }
  }

  async first<T>(): Promise<T | null> {
    const rows = this.select()
    return (rows[0] ?? null) as T | null
  }

  private norm(): string {
    return this.sql.toLowerCase().replace(/\s+/g, " ").trim()
  }

  private select(): Row[] {
    const sql = this.norm()

    if (sql.startsWith("select slug, entity_type, title, summary, sections_json") && sql.includes("from wiki_pages")) {
      return this.db.wikiPages.map((page) => ({
        slug: page.slug,
        entity_type: page.entity_type,
        title: page.title,
        summary: page.summary,
        sections_json: page.sections_json,
        cross_refs_json: page.cross_refs_json,
        source_event_ids_json: page.source_event_ids_json,
        generated_at: page.generated_at,
        byok_provider: page.byok_provider,
        unverified_count: page.unverified_count,
        view_count: page.view_count,
        updated_at: page.updated_at,
      }))
    }

    if (sql.includes("select id, field, value") && sql.includes("value_norm") && sql.includes("from wiki_contributions")) {
      const slug = String(this.params[0] ?? "")
      return this.db.wikiContributions
        .filter((row) => String(row.collection_slug) === slug)
        .filter((row) => String(row.status) === "published")
        .map((row) => ({
          id: row.id,
          field: row.field,
          value: row.value,
          value_norm: row.value_norm,
          contributor_id: row.contributor_id,
          og_tier: row.og_tier,
          created_at: row.created_at,
        }))
    }

    if (sql.includes("select id, collection_slug, field, value, confidence, verifiable") && sql.includes("from wiki_contributions")) {
      const slug = String(this.params[0] ?? "")
      return this.db.wikiContributions
        .filter((row) => String(row.collection_slug) === slug)
        .filter((row) => {
          const status = String(row.status)
          return status === "published" || status === "quarantine"
        })
        .map((row) => ({
          id: row.id,
          collection_slug: row.collection_slug,
          field: row.field,
          value: row.value,
          confidence: row.confidence,
          verifiable: row.verifiable,
          contributor_id: row.contributor_id,
          og_tier: row.og_tier,
          status: row.status,
          created_at: row.created_at,
        }))
    }

    if (sql.includes("select count(*) as count, min(timestamp) as first_seen, max(timestamp) as last_seen") && sql.includes("from raw_chronicle_events")) {
      const like = String(this.params[0] ?? "")
      const token = like.replace(/%/g, "")
      const rows = this.db.rawEvents.filter((row) => {
        return String(row.event_type) === "genesis" && String(row.metadata_json).includes(token)
      })
      const timestamps = rows.map((row) => String(row.timestamp)).sort()
      return [{
        count: rows.length,
        first_seen: timestamps[0] ?? null,
        last_seen: timestamps[timestamps.length - 1] ?? null,
        inscription_id: rows[0]?.inscription_id ?? null,
      }]
    }

    if (sql.includes("from raw_chronicle_events") && sql.includes("where id in")) {
      const ids = this.params.map((param) => String(param))
      return this.db.rawEvents
        .filter((row) => ids.includes(String(row.id)))
        .map((row) => ({
          id: row.id,
          inscription_id: row.inscription_id,
          event_type: row.event_type,
          timestamp: row.timestamp,
          block_height: row.block_height,
          source_type: row.source_type,
          source_ref: row.source_ref,
          description: row.description,
          metadata_json: row.metadata_json,
        }))
    }

    return []
  }
}

function createEnv(db: GraphTestDatabase): Env {
  return {
    CHRONICLES_KV: {} as KVNamespace,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    ENVIRONMENT: "test",
    DB: db as unknown as D1Database,
  }
}

function seedDb(): GraphTestDatabase {
  const db = new GraphTestDatabase()

  db.rawEvents.push(
    {
      id: "ev_genesis_1",
      inscription_id: "frog0001i0",
      event_type: "genesis",
      timestamp: "2024-01-01T00:00:00.000Z",
      block_height: 800000,
      source_type: "onchain",
      source_ref: "a".repeat(64),
      description: "Genesis event",
      metadata_json: JSON.stringify({ collection_slug: "bitcoin-frogs" }),
    },
    {
      id: "ev_transfer_1",
      inscription_id: "frog0001i0",
      event_type: "transfer",
      timestamp: "2024-03-01T00:00:00.000Z",
      block_height: 801000,
      source_type: "onchain",
      source_ref: "b".repeat(64),
      description: "Transferred between collectors",
      metadata_json: JSON.stringify({ collection_slug: "bitcoin-frogs" }),
    }
  )

  db.wikiPages.push(
    {
      slug: "collection:bitcoin-frogs",
      entity_type: "collection",
      title: "Bitcoin Frogs",
      summary: "Collector-led frog lineage.",
      sections_json: JSON.stringify([]),
      cross_refs_json: JSON.stringify([]),
      source_event_ids_json: JSON.stringify(["ev_genesis_1"]),
      generated_at: "2026-04-01T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
      view_count: 0,
      updated_at: "2026-04-01T00:00:00.000Z",
    },
    {
      slug: "inscription:frog0001i0",
      entity_type: "inscription",
      title: "Frog #1",
      summary: "Genesis frog page.",
      sections_json: JSON.stringify([{ heading: "Overview", body: "Body", source_event_ids: ["ev_genesis_1", "ev_transfer_1"] }]),
      cross_refs_json: JSON.stringify(["collection:bitcoin-frogs", "inscription:frog0002i0", "artist:ghost-frog"]),
      source_event_ids_json: JSON.stringify(["ev_transfer_1", "ev_genesis_1"]),
      generated_at: "2026-04-05T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
      view_count: 0,
      updated_at: "2026-04-05T00:00:00.000Z",
    },
    {
      slug: "inscription:frog0002i0",
      entity_type: "inscription",
      title: "Frog #2",
      summary: "Second frog page.",
      sections_json: JSON.stringify([{ heading: "Overview", body: "Body", source_event_ids: ["ev_genesis_1"] }]),
      cross_refs_json: JSON.stringify(["collection:bitcoin-frogs"]),
      source_event_ids_json: JSON.stringify(["ev_genesis_1"]),
      generated_at: "2026-04-06T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 1,
      view_count: 0,
      updated_at: "2026-04-06T00:00:00.000Z",
    }
  )

  db.wikiContributions.push(
    {
      id: "wc_founder",
      collection_slug: "bitcoin-frogs",
      field: "founder",
      value: "PepeMint",
      confidence: "stated_by_user",
      verifiable: 1,
      contributor_id: "u1",
      og_tier: "og",
      status: "published",
      created_at: "2026-04-10T00:00:00.000Z",
    },
    {
      id: "wc_culture",
      collection_slug: "bitcoin-frogs",
      field: "community_culture",
      value: "Collector meme energy",
      confidence: "stated_by_user",
      verifiable: 0,
      contributor_id: "u2",
      og_tier: "community",
      status: "quarantine",
      created_at: "2026-04-11T00:00:00.000Z",
    },
    {
      id: "wc_conn_a",
      collection_slug: "bitcoin-frogs",
      field: "connections",
      value: "Connected to Rare Pepes",
      confidence: "stated_by_user",
      verifiable: 1,
      contributor_id: "u3",
      og_tier: "og",
      status: "published",
      created_at: "2026-04-12T00:00:00.000Z",
    },
    {
      id: "wc_conn_b",
      collection_slug: "bitcoin-frogs",
      field: "connections",
      value: "Connected to Counterparty art",
      confidence: "stated_by_user",
      verifiable: 1,
      contributor_id: "u4",
      og_tier: "og",
      status: "published",
      created_at: "2026-04-13T00:00:00.000Z",
    }
  )

  return db
}

describe("buildCollectionGraph", () => {
  it("maps canonical, draft, and disputed knowledge into graph nodes and edges", async () => {
    const graph = await buildCollectionGraph("bitcoin-frogs", createEnv(seedDb()), {
      focus: "inscription:frog0001i0",
    })

    expect(graph.focus_node_id).toBe("inscription:frog0001i0")
    expect(graph.nodes.find((node) => node.id === "field:bitcoin-frogs:founder")?.status).toBe("canonical")
    expect(graph.nodes.find((node) => node.id === "field:bitcoin-frogs:community_culture")?.status).toBe("draft")
    expect(graph.nodes.find((node) => node.id === "field:bitcoin-frogs:connections")?.status).toBe("disputed")

    expect(graph.nodes.find((node) => node.id === "claim:bitcoin-frogs:wc_founder")?.status).toBe("canonical")
    expect(graph.nodes.find((node) => node.id === "claim:bitcoin-frogs:wc_culture")?.status).toBe("draft")
    expect(graph.nodes.find((node) => node.id === "claim:bitcoin-frogs:wc_conn_a")?.status).toBe("disputed")
  })

  it("includes linked inscription pages, deduplicated source events, and unresolved refs", async () => {
    const graph = await buildCollectionGraph("bitcoin-frogs", createEnv(seedDb()))

    expect(graph.nodes.some((node) => node.id === "inscription:frog0001i0" && node.kind === "wiki_page")).toBe(true)
    expect(graph.nodes.some((node) => node.id === "inscription:frog0002i0" && node.kind === "wiki_page")).toBe(true)
    expect(graph.nodes.some((node) => node.id === "external:artist:ghost-frog" && node.kind === "external_ref")).toBe(true)
    expect(
      graph.edges.some((edge) =>
        edge.kind === "belongs_to_collection"
        && edge.source === "collection:bitcoin-frogs"
        && edge.target === "inscription:frog0001i0"
      )
    ).toBe(true)

    const sourceEventNodes = graph.nodes.filter((node) => node.kind === "source_event")
    expect(sourceEventNodes.map((node) => node.id)).toEqual(["ev_genesis_1", "ev_transfer_1"])
    expect(graph.edges.filter((edge) => edge.kind === "cites_event")).toHaveLength(3)
    expect(graph.warnings.some((warning) => warning.includes("could not be resolved"))).toBe(true)
  })

  it("builds the same deterministic order across repeated runs", async () => {
    const env = createEnv(seedDb())
    const graphA = await buildCollectionGraph("bitcoin-frogs", env)
    const graphB = await buildCollectionGraph("bitcoin-frogs", env)

    expect(graphA.nodes.map((node) => node.id)).toEqual(graphB.nodes.map((node) => node.id))
    expect(graphA.edges.map((edge) => edge.id)).toEqual(graphB.edges.map((edge) => edge.id))
  })
})
