import { describe, expect, it } from "vitest"
import { strFromU8, unzipSync } from "fflate"
import worker, { type Env } from "../../src/worker/index"
import { signJWT } from "../../src/worker/auth/jwt"

type Row = Record<string, unknown>

const FULL_SCHEMA_OBJECTS = [
  "raw_chronicle_events",
  "wiki_pages",
  "wiki_log",
  "wiki_fts",
  "wiki_contributions",
  "consolidated_cache",
]

class ExportDb {
  schemaObjects = new Set(FULL_SCHEMA_OBJECTS)
  wikiPages: Row[] = []
  wikiContributions: Row[] = []
  consolidatedCache: Row[] = []
  rawEvents: Row[] = []

  prepare(sql: string): ExportStatement {
    return new ExportStatement(this, sql)
  }
}

class ExportStatement {
  private params: unknown[] = []

  constructor(
    private db: ExportDb,
    private sql: string
  ) {}

  bind(...params: unknown[]): ExportStatement {
    this.params = params
    return this
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.execSelect() as T[] }
  }

  async first<T>(): Promise<T | null> {
    const rows = this.execSelect()
    return (rows[0] ?? null) as T | null
  }

  async run(): Promise<{ success: boolean }> {
    return { success: true }
  }

  private norm(): string {
    return this.sql.toLowerCase().replace(/\s+/g, " ").trim()
  }

  private execSelect(): Row[] {
    const sql = this.norm()

    if (sql.includes("from sqlite_schema")) {
      return this.params
        .map((name) => String(name))
        .filter((name) => this.db.schemaObjects.has(name))
        .map((name) => ({ name }))
    }

    if (sql.includes("from wiki_pages") && sql.includes("order by slug asc")) {
      return [...this.db.wikiPages].sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    }

    if (sql.includes("select distinct collection_slug") && sql.includes("from wiki_contributions")) {
      const slugs = [...new Set(
        this.db.wikiContributions
          .filter((row) => String(row.status) === "published")
          .map((row) => String(row.collection_slug))
      )].sort((a, b) => a.localeCompare(b))

      return slugs.map((collection_slug) => ({ collection_slug }))
    }

    if (sql.includes("from consolidated_cache") && sql.includes("where collection_slug = ?")) {
      const slug = String(this.params[0] ?? "")
      const row = this.db.consolidatedCache.find((item) => String(item.collection_slug) === slug)
      return row ? [row] : []
    }

    if (sql.includes("from raw_chronicle_events") && sql.includes("where id in")) {
      const ids = this.params.map((item) => String(item))
      return this.db.rawEvents.filter((item) => ids.includes(String(item.id)))
    }

    return []
  }
}

function createEnv(db?: ExportDb): Env {
  return {
    CHRONICLES_KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace,
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 }),
    },
    ENVIRONMENT: "test",
    DB: db as unknown as D1Database,
    JWT_SECRET: "wiki-export-secret",
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await signJWT({
    sub: "discord-user-1",
    username: "collector42",
    avatar: null,
    tier: "community",
  }, "wiki-export-secret")

  return { Authorization: `Bearer ${token}` }
}

function seedDb(): ExportDb {
  const db = new ExportDb()

  db.wikiPages.push(
    {
      slug: "collection:runestone",
      entity_type: "collection",
      title: "Runestone",
      summary: "Public collection page.",
      sections_json: JSON.stringify([
        {
          heading: "Overview",
          body: "Runestone is a public collection page.",
          source_event_ids: ["ev_collection_link"],
        },
      ]),
      cross_refs_json: JSON.stringify(["inscription:rooti0"]),
      source_event_ids_json: JSON.stringify(["ev_collection_link"]),
      generated_at: "2026-05-01T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
      view_count: 12,
      updated_at: "2026-05-02T00:00:00.000Z",
    },
    {
      slug: "inscription:rooti0",
      entity_type: "inscription",
      title: "Runestone #7",
      summary: "Public inscription page.",
      sections_json: JSON.stringify([
        {
          heading: "Chronicle",
          body: "Structured public page with explicit sourcing.",
          source_event_ids: ["ev_genesis", "ev_sale"],
          unverified_claims: true,
        },
      ]),
      cross_refs_json: JSON.stringify(["collection:runestone"]),
      source_event_ids_json: JSON.stringify(["ev_genesis", "ev_sale"]),
      generated_at: "2026-05-03T00:00:00.000Z",
      byok_provider: "gemini",
      unverified_count: 1,
      view_count: 7,
      updated_at: "2026-05-04T00:00:00.000Z",
    }
  )

  db.wikiContributions.push(
    {
      id: "wc_published",
      collection_slug: "runestone",
      field: "founder",
      value: "Casey Rodarmor",
      confidence: "stated_by_user",
      verifiable: 1,
      contributor_id: "discord-private-id",
      og_tier: "og",
      status: "published",
      session_id: "private-session",
      source_excerpt: "private excerpt",
      created_at: "2026-05-02T10:00:00.000Z",
    },
    {
      id: "wc_quarantine",
      collection_slug: "runestone",
      field: "community_culture",
      value: "Should never leave moderation.",
      confidence: "stated_by_user",
      verifiable: 0,
      contributor_id: "discord-private-id-2",
      og_tier: "community",
      status: "quarantine",
      session_id: "private-session-2",
      source_excerpt: "do not export",
      created_at: "2026-05-02T11:00:00.000Z",
    }
  )

  db.consolidatedCache.push({
    collection_slug: "runestone",
    snapshot_json: JSON.stringify({
      collection_slug: "runestone",
      sample_inscription_id: "rooti0",
      completeness: {
        filled: 2,
        total: 4,
        score: 0.5,
      },
      confidence: 0.75,
      factual: {
        supply: 112400,
        first_seen: "2024-04-20T00:00:00.000Z",
        last_seen: "2024-05-16T00:00:00.000Z",
      },
      narrative: {
        founder: {
          field: "founder",
          canonical_value: "Casey Rodarmor",
          status: "canonical",
          resolved_by_tier: "og",
          contributions: [
            {
              value: "Casey Rodarmor",
              contributor_id: "discord-private-id",
              og_tier: "og",
              weight: 3,
              created_at: "2026-05-02T10:00:00.000Z",
            },
          ],
        },
        community_culture: {
          field: "community_culture",
          canonical_value: null,
          status: "draft",
          resolved_by_tier: "community",
          contributions: [
            {
              value: "The frogs became a meme.",
              contributor_id: "discord-private-id-3",
              og_tier: "community",
              weight: 2,
              created_at: "2026-05-03T10:00:00.000Z",
            },
          ],
        },
        provenance: {
          field: "provenance",
          canonical_value: null,
          status: "disputed",
          resolved_by_tier: "disputed",
          contributions: [
            {
              value: "Version A",
              contributor_id: "discord-private-id-4",
              og_tier: "og",
              weight: 3,
              created_at: "2026-05-04T10:00:00.000Z",
            },
            {
              value: "Version B",
              contributor_id: "discord-private-id-5",
              og_tier: "og",
              weight: 3,
              created_at: "2026-05-05T10:00:00.000Z",
            },
          ],
        },
      },
      sources: [
        {
          contributor_id: "discord-private-id",
          og_tier: "og",
          field: "founder",
          created_at: "2026-05-02T10:00:00.000Z",
        },
      ],
      gaps: ["artist"],
    }),
    updated_at: "2999-01-01T00:00:00.000Z",
  })

  db.rawEvents.push(
    {
      id: "ev_collection_link",
      inscription_id: "rooti0",
      event_type: "collection_link",
      timestamp: "2024-05-16T00:00:00.000Z",
      block_height: 842050,
      source_type: "web",
      source_ref: "https://ord.net/collection/runestone",
      description: "Linked to collection",
      metadata_json: JSON.stringify({ collection: "runestone" }),
    },
    {
      id: "ev_genesis",
      inscription_id: "rooti0",
      event_type: "genesis",
      timestamp: "2024-04-20T00:00:00.000Z",
      block_height: 840000,
      source_type: "onchain",
      source_ref: "root",
      description: "Genesis event",
      metadata_json: JSON.stringify({ block: 840000 }),
    },
    {
      id: "ev_sale",
      inscription_id: "rooti0",
      event_type: "sale",
      timestamp: "2024-05-15T00:00:00.000Z",
      block_height: 842000,
      source_type: "web",
      source_ref: "https://example.com/sale",
      description: "Sale event",
      metadata_json: JSON.stringify({ price_btc: "0.12" }),
    }
  )

  return db
}

function unzipArchive(buffer: Uint8Array) {
  const archive = unzipSync(buffer)
  return Object.fromEntries(
    Object.entries(archive).map(([name, data]) => [name, strFromU8(data)])
  )
}

describe("wiki export route", () => {
  it("returns an authenticated zip snapshot with sanitized public data", async () => {
    const db = seedDb()
    const env = createEnv(db)

    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/export", {
      headers: await authHeader(),
    }), env)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/zip")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Content-Disposition")).toContain("ordinalmind-wiki-export-")

    const files = unzipArchive(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files)).toContain("README.md")
    expect(Object.keys(files)).toContain("manifest.json")
    expect(Object.keys(files)).toContain("wiki-pages/index.json")
    expect(Object.keys(files)).toContain("consensus/index.json")
    expect(Object.keys(files)).toContain("sources/raw-events.json")
    expect(Object.keys(files)).toContain("consensus/collection/runestone.json")

    const manifest = JSON.parse(files["manifest.json"]!) as Record<string, unknown>
    expect(manifest.schema_version).toBe("2026-05-06.1")
    expect((manifest.counts as Record<string, number>).wiki_pages).toBe(2)

    const consensus = JSON.parse(files["consensus/collection/runestone.json"]!) as Record<string, unknown>
    expect(consensus.scope).toBe("collection")
    const narrative = consensus.narrative as Record<string, Record<string, unknown>>
    expect(narrative.founder.status).toBe("canonical")
    expect(narrative.community_culture.status).toBe("draft")
    expect(narrative.provenance.status).toBe("disputed")
    expect(files["consensus/collection/runestone.json"]).not.toContain("contributor_id")
    expect(files["consensus/collection/runestone.json"]).not.toContain("session_id")
    expect(files["consensus/collection/runestone.json"]).not.toContain("source_excerpt")
    expect(files["consensus/collection/runestone.json"]).not.toContain("discord-private-id")
    expect(files["consensus/collection/runestone.md"]).toContain("Status: disputed")

    const pagesIndex = JSON.parse(files["wiki-pages/index.json"]!) as Array<Record<string, unknown>>
    expect(pagesIndex.map((page) => page.slug)).toEqual(["collection:runestone", "inscription:rooti0"])

    const rawEvents = JSON.parse(files["sources/raw-events.json"]!) as Array<Record<string, unknown>>
    expect(rawEvents).toHaveLength(3)
    expect(files["wiki-pages/inscription/inscription-rooti0.md"]).toContain("status_summary: \"partial\"")
  })

  it("rejects missing or invalid auth tokens", async () => {
    const env = createEnv(seedDb())

    const missingRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/export"), env)
    expect(missingRes.status).toBe(401)
    expect((await missingRes.json() as Record<string, unknown>).error).toBe("missing_auth_token")

    const invalidRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/export", {
      headers: {
        Authorization: "Bearer invalid-token",
      },
    }), env)
    expect(invalidRes.status).toBe(401)
    expect((await invalidRes.json() as Record<string, unknown>).error).toBe("invalid_auth_token")
  })

  it("fails softly when DB/schema is unavailable", async () => {
    const noDbEnv = createEnv(undefined)
    const noDbRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/export", {
      headers: await authHeader(),
    }), noDbEnv)
    expect(noDbRes.status).toBe(503)
    expect((await noDbRes.json() as Record<string, unknown>).error).toBe("wiki_db_unavailable")

    const incompleteDb = seedDb()
    incompleteDb.schemaObjects = new Set(["raw_chronicle_events"])
    const incompleteEnv = createEnv(incompleteDb)
    const incompleteRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/export", {
      headers: await authHeader(),
    }), incompleteEnv)
    expect(incompleteRes.status).toBe(503)
    expect((await incompleteRes.json() as Record<string, unknown>).error).toBe("wiki_schema_incomplete")
  })
})
