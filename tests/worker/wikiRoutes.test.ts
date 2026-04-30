import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"

type Row = Record<string, unknown>

const FULL_SCHEMA_OBJECTS = [
  "raw_chronicle_events",
  "wiki_pages",
  "wiki_log",
  "wiki_fts",
]

class FakeD1Database {
  rawEvents: Row[] = []
  wikiPages: Row[] = []
  wikiLog: Row[] = []
  schemaObjects: Set<string>
  failViewCountUpdate = false

  constructor(schemaObjects: string[] = FULL_SCHEMA_OBJECTS) {
    this.schemaObjects = new Set(schemaObjects)
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql)
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    for (const statement of statements) {
      await statement.run()
    }
    return []
  }
}

class FakeD1Statement {
  private params: unknown[] = []

  constructor(
    private db: FakeD1Database,
    private sql: string
  ) {}

  bind(...params: unknown[]): FakeD1Statement {
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
    this.execMutate()
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

    if (sql.includes("select id from raw_chronicle_events where id in")) {
      const ids = this.params as string[]
      return this.db.rawEvents
        .filter((event) => ids.includes(String(event.id)))
        .map((event) => ({ id: event.id }))
    }

    if (sql.includes("from wiki_pages") && sql.includes("where slug = ?") && sql.includes("limit 1") && !sql.includes("select 1 as exists_flag")) {
      const slug = String(this.params[0] ?? "")
      const page = this.db.wikiPages.find((item) => String(item.slug) === slug)
      return page ? [page] : []
    }

    if (sql.includes("select wp.slug, wp.title") && sql.includes("from wiki_pages wp") && sql.includes("not exists")) {
      return this.db.wikiPages
        .filter((page) => String(page.entity_type) === "inscription")
        .filter((page) => {
          const slug = String(page.slug)
          const inscriptionId = slug.startsWith("inscription:") ? slug.slice("inscription:".length) : ""
          return !this.db.rawEvents.some((event) => String(event.inscription_id) === inscriptionId)
        })
        .map((page) => ({ slug: page.slug, title: page.title }))
    }

    if (sql.includes("select slug, generated_at") && sql.includes("from wiki_pages") && sql.includes("where generated_at < datetime('now', '-30 days')")) {
      return this.db.wikiPages
        .filter((page) => typeof page.generated_at === "string" && page.generated_at < "2026-03-29")
        .map((page) => ({ slug: page.slug, generated_at: page.generated_at }))
    }

    if (sql.includes("select slug, cross_refs_json from wiki_pages")) {
      return this.db.wikiPages.map((page) => ({
        slug: page.slug,
        cross_refs_json: page.cross_refs_json,
      }))
    }

    if (sql.includes("select 1 as exists_flag from wiki_pages where slug = ? limit 1")) {
      const slug = String(this.params[0] ?? "")
      const exists = this.db.wikiPages.some((item) => String(item.slug) === slug)
      return exists ? [{ exists_flag: 1 }] : []
    }

    if (sql.includes("from wiki_fts") && sql.includes("join wiki_pages wp on wiki_fts.slug = wp.slug")) {
      const query = String(this.params[0] ?? "")
      const entityType = sql.includes("and wp.entity_type = ?") ? String(this.params[1] ?? "") : ""
      const limitParam = sql.includes("and wp.entity_type = ?") ? this.params[2] : this.params[1]
      const limit = Number(limitParam ?? 5)

      const token = query.replace(/\*/g, "").toLowerCase().trim()
      const filtered = this.db.wikiPages
        .filter((page) => (entityType ? String(page.entity_type) === entityType : true))
        .filter((page) => {
          const haystack = `${String(page.title ?? "")} ${String(page.summary ?? "")}`.toLowerCase()
          return token ? haystack.includes(token) : false
        })
        .slice(0, limit)

      return filtered.map((page, index) => ({
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        entity_type: page.entity_type,
        unverified_count: page.unverified_count,
        score: index,
      }))
    }

    if (sql.includes("from raw_chronicle_events") && sql.includes("where inscription_id = ?") && sql.includes("order by timestamp asc")) {
      const inscriptionId = String(this.params[0] ?? "")
      const hasEventTypes = sql.includes("and event_type in")
      const limit = Number(this.params[this.params.length - 1] ?? 50)

      let eventTypes: string[] = []
      if (hasEventTypes) {
        eventTypes = this.params.slice(1, this.params.length - 1).map((item) => String(item))
      }

      return this.db.rawEvents
        .filter((event) => String(event.inscription_id) === inscriptionId)
        .filter((event) => (eventTypes.length > 0 ? eventTypes.includes(String(event.event_type)) : true))
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
        .slice(0, limit)
        .map((event) => ({
          id: event.id,
          event_type: event.event_type,
          timestamp: event.timestamp,
          block_height: event.block_height,
          source_type: event.source_type,
          source_ref: event.source_ref,
          description: event.description,
          metadata_json: event.metadata_json,
        }))
    }

    if (sql.includes("select count(*) as count, min(timestamp) as first_seen, max(timestamp) as last_seen") && sql.includes("from raw_chronicle_events")) {
      const like = String(this.params[0] ?? "")
      const token = like.replace(/%/g, "")
      const rows = this.db.rawEvents.filter((event) => {
        return String(event.event_type) === "genesis" && String(event.metadata_json).includes(token)
      })
      const timestamps = rows.map((event) => String(event.timestamp)).sort()
      return [{
        count: rows.length,
        first_seen: timestamps[0] ?? null,
        last_seen: timestamps[timestamps.length - 1] ?? null,
      }]
    }

    if (sql.includes("select slug, title, unverified_count") && sql.includes("from wiki_pages") && sql.includes("where unverified_count > 0")) {
      return this.db.wikiPages
        .filter((page) => Number(page.unverified_count ?? 0) > 0)
        .map((page) => ({
          slug: page.slug,
          title: page.title,
          unverified_count: page.unverified_count,
        }))
    }

    return []
  }

  private execMutate(): void {
    const sql = this.norm()

    if (sql.includes("insert into wiki_pages") && sql.includes("on conflict(slug) do update set")) {
      const [
        slug,
        entityType,
        title,
        summary,
        sectionsJson,
        crossRefsJson,
        sourceEventIdsJson,
        generatedAt,
        byokProvider,
        unverifiedCount,
        updatedAt,
      ] = this.params

      const next: Row = {
        slug,
        entity_type: entityType,
        title,
        summary,
        sections_json: sectionsJson,
        cross_refs_json: crossRefsJson,
        source_event_ids_json: sourceEventIdsJson,
        generated_at: generatedAt,
        byok_provider: byokProvider,
        unverified_count: unverifiedCount,
        updated_at: updatedAt,
        view_count: 0,
      }

      const index = this.db.wikiPages.findIndex((page) => String(page.slug) === String(slug))
      if (index >= 0) {
        const current = this.db.wikiPages[index]
        this.db.wikiPages[index] = {
          ...current,
          ...next,
          view_count: current.view_count ?? 0,
        }
      } else {
        this.db.wikiPages.push(next)
      }
      return
    }

    if (sql.includes("insert into wiki_log")) {
      this.db.wikiLog.push({
        operation: this.params[0],
        slug: this.params[1],
        detail_json: this.params[2],
      })
      return
    }

    if (sql.includes("update wiki_pages") && sql.includes("set view_count = view_count + 1")) {
      if (this.db.failViewCountUpdate) {
        throw new Error("D1_ERROR: no such table: wiki_pages: SQLITE_ERROR")
      }

      const slug = String(this.params[0] ?? "")
      const row = this.db.wikiPages.find((page) => String(page.slug) === slug)
      if (row) {
        row.view_count = Number(row.view_count ?? 0) + 1
      }
      return
    }

    if (sql.includes("insert or ignore into raw_chronicle_events")) {
      const [
        id,
        inscriptionId,
        eventType,
        timestamp,
        blockHeight,
        sourceType,
        sourceRef,
        description,
        metadataJson,
      ] = this.params

      const exists = this.db.rawEvents.some((event) => String(event.id) === String(id))
      if (exists) return

      this.db.rawEvents.push({
        id,
        inscription_id: inscriptionId,
        event_type: eventType,
        timestamp,
        block_height: blockHeight,
        source_type: sourceType,
        source_ref: sourceRef,
        description,
        metadata_json: metadataJson,
      })
    }
  }
}

function createEnv(options?: { withDb?: boolean; db?: FakeD1Database }): Env {
  const kvStore = new Map<string, string>()
  const chronicle = {
    inscription_id: "abc123i0",
    meta: {
      inscription_id: "abc123i0",
      inscription_number: 7,
      sat: 123,
      sat_rarity: "common",
      content_type: "image/png",
      content_url: "https://ordinals.com/content/abc",
      genesis_block: 800000,
      genesis_timestamp: "2024-01-01T00:00:00.000Z",
      genesis_fee: 10,
      owner_address: "bc1powner",
      genesis_txid: "a".repeat(64),
      genesis_vout: 0,
    },
    events: [],
    collector_signals: {
      attention_score: 0,
      sentiment_label: "insufficient_data",
      confidence: "low",
      evidence_count: 0,
      provider_breakdown: { google_trends: 0 },
      scope_breakdown: {
        inscription_level: 0,
        collection_level: 0,
        mixed: 0,
        dominant_scope: "none",
      },
      top_evidence: [],
      windows: {
        current_7d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
        context_30d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
      },
    },
    media_context: {
      kind: "image",
      content_type: "image/png",
      content_url: "https://ordinals.com/content/abc",
      preview_url: "https://ordinals.com/content/abc",
      vision_eligible: true,
      vision_transport: "public_url",
    },
    collection_context: {
      protocol: { parents: null, children: null, grandchildren: null, gallery: null, grandparents: null, greatGrandparents: null },
      registry: { match: null, issues: [] },
      market: { match: null },
      profile: null,
      socials: { official_x_profiles: [] },
      presentation: { facets: [] },
    },
    source_catalog: [],
    cached_at: "2024-01-01T00:00:00.000Z",
  }

  kvStore.set("abc123i0", JSON.stringify(chronicle))

  const env: Env = {
    CHRONICLES_KV: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    } as unknown as KVNamespace,
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 }),
    },
    ENVIRONMENT: "test",
  }

  if (options?.withDb) {
    const db = options.db ?? new FakeD1Database()
    env.DB = db as unknown as D1Database
  }

  return env
}

function seedDb(): FakeD1Database {
  const db = new FakeD1Database()

  db.rawEvents.push({
    id: "ev_genesis_1",
    inscription_id: "abc123i0",
    event_type: "genesis",
    timestamp: "2024-01-01T00:00:00.000Z",
    block_height: 800000,
    source_type: "onchain",
    source_ref: "a".repeat(64),
    description: "Inscribed at block 800000",
    metadata_json: JSON.stringify({ collection_slug: "bitcoin-frogs" }),
  })

  db.wikiPages.push({
    slug: "collection:bitcoin-frogs",
    entity_type: "collection",
    title: "Bitcoin Frogs",
    summary: "Early Ordinals collection.",
    sections_json: JSON.stringify([]),
    cross_refs_json: JSON.stringify([]),
    source_event_ids_json: JSON.stringify(["ev_genesis_1"]),
    generated_at: "2026-04-01T00:00:00.000Z",
    byok_provider: "openai",
    unverified_count: 0,
    view_count: 0,
    updated_at: "2026-04-01T00:00:00.000Z",
  })

  return db
}

describe("wiki routes backend", () => {
  it("reports wiki health for ready, missing, and incomplete schemas", async () => {
    const readyEnv = createEnv({ withDb: true, db: seedDb() })
    const readyRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/health"), readyEnv)
    expect(readyRes.status).toBe(200)
    const readyBody = await readyRes.json() as Record<string, unknown>
    expect(readyBody.status).toBe("ready")
    expect(readyBody.ready).toBe(true)

    const missingEnv = createEnv({ withDb: true, db: new FakeD1Database([]) })
    const missingRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/health"), missingEnv)
    expect(missingRes.status).toBe(503)
    const missingBody = await missingRes.json() as Record<string, unknown>
    expect(missingBody.status).toBe("schema_missing")
    expect(missingBody.error).toBe("wiki_schema_missing")

    const incompleteEnv = createEnv({ withDb: true, db: new FakeD1Database(["raw_chronicle_events"]) })
    const incompleteRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/health"), incompleteEnv)
    expect(incompleteRes.status).toBe(503)
    const incompleteBody = await incompleteRes.json() as Record<string, unknown>
    expect(incompleteBody.status).toBe("schema_incomplete")
    expect(incompleteBody.error).toBe("wiki_schema_incomplete")
  })

  it("fail-soft when DB is missing, without breaking cache-backed tools", async () => {
    const env = createEnv()

    const healthReq = new Request("https://ordinalmind.local/api/wiki/health")
    const healthRes = await worker.fetch(healthReq, env)
    expect(healthRes.status).toBe(503)
    const healthBody = await healthRes.json() as Record<string, unknown>
    expect(healthBody.error).toBe("wiki_db_unavailable")

    const pageReq = new Request("https://ordinalmind.local/api/wiki/inscription:abc123i0")
    const pageRes = await worker.fetch(pageReq, env)
    expect(pageRes.status).toBe(503)
    const pageBody = await pageRes.json() as Record<string, unknown>
    expect(pageBody.error).toBe("wiki_db_unavailable")

    const lintReq = new Request("https://ordinalmind.local/api/wiki/lint")
    const lintRes = await worker.fetch(lintReq, env)
    expect(lintRes.status).toBe(503)

    const timelineReq = new Request("https://ordinalmind.local/api/wiki/tools/get_timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscription_id: "abc123i0" }),
    })
    const timelineRes = await worker.fetch(timelineReq, env)
    expect(timelineRes.status).toBe(200)
    const timelineBody = await timelineRes.json() as Record<string, unknown>
    expect(timelineBody.ok).toBe(true)
    expect(timelineBody.source).toBe("chronicle_cache")

    const collectionReq = new Request("https://ordinalmind.local/api/wiki/tools/get_collection_context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_slug: "bitcoin-frogs" }),
    })
    const collectionRes = await worker.fetch(collectionReq, env)
    expect(collectionRes.status).toBe(200)
    const collectionBody = await collectionRes.json() as Record<string, unknown>
    expect(collectionBody.error).toBe("wiki_db_unavailable")
  })

  it("returns fail-soft wiki schema errors for page, ingest, lint, and DB-backed tools", async () => {
    const env = createEnv({ withDb: true, db: new FakeD1Database([]) })

    const pageRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/inscription:abc123i0"), env)
    expect(pageRes.status).toBe(503)
    const pageBody = await pageRes.json() as Record<string, unknown>
    expect(pageBody.error).toBe("wiki_schema_missing")

    const ingestRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "inscription:abc123i0",
        entity_type: "inscription",
        title: "#7",
        summary: "summary",
        sections: [{ heading: "Overview", body: "Body", source_event_ids: ["ev_genesis_1"] }],
        cross_refs: [],
        source_event_ids: ["ev_genesis_1"],
        generated_at: "2026-04-28T00:00:00.000Z",
        byok_provider: "openai",
      }),
    }), env)
    expect(ingestRes.status).toBe(503)
    const ingestBody = await ingestRes.json() as Record<string, unknown>
    expect(ingestBody.error).toBe("wiki_schema_missing")

    const lintRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/lint"), env)
    expect(lintRes.status).toBe(503)

    const searchRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/tools/search_wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "frogs" }),
    }), env)
    expect(searchRes.status).toBe(200)
    const searchBody = await searchRes.json() as Record<string, unknown>
    expect(searchBody.error).toBe("wiki_schema_missing")
    expect(searchBody.partial).toBe(true)

    const rawRes = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/tools/get_raw_events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscription_id: "abc123i0" }),
    }), env)
    const rawBody = await rawRes.json() as Record<string, unknown>
    expect(rawBody.error).toBe("wiki_schema_missing")
  })

  it("ingests wiki pages and marks unverified claims", async () => {
    const db = seedDb()
    const env = createEnv({ withDb: true, db })

    const ingestReq = new Request("https://ordinalmind.local/api/wiki/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "inscription:abc123i0",
        entity_type: "inscription",
        title: "#7",
        summary: "Test summary",
        sections: [
          {
            heading: "Overview",
            body: "Factual overview",
            source_event_ids: ["ev_genesis_1", "ev_missing_999"],
          },
        ],
        cross_refs: ["collection:bitcoin-frogs"],
        source_event_ids: ["ev_genesis_1", "ev_missing_999"],
        generated_at: "2026-04-28T00:00:00.000Z",
        byok_provider: "openai",
      }),
    })

    const ingestRes = await worker.fetch(ingestReq, env)
    expect(ingestRes.status).toBe(200)
    const ingestBody = await ingestRes.json() as Record<string, unknown>
    expect(ingestBody.ok).toBe(true)
    expect(ingestBody.unverified_count).toBe(1)

    const pageReq = new Request("https://ordinalmind.local/api/wiki/inscription:abc123i0")
    const pageRes = await worker.fetch(pageReq, env)
    expect(pageRes.status).toBe(200)
    const pageBody = await pageRes.json() as Record<string, unknown>
    expect(pageBody.ok).toBe(true)
    expect(pageBody.unverified_count).toBe(1)

    const sections = pageBody.sections as Array<Record<string, unknown>>
    expect(sections[0].unverified_claims).toBe(true)
  })

  it("supports search_wiki, get_raw_events, get_collection_context and lint", async () => {
    const db = seedDb()
    const env = createEnv({ withDb: true, db })

    const searchReq = new Request("https://ordinalmind.local/api/wiki/tools/search_wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "frogs", limit: 5 }),
    })
    const searchRes = await worker.fetch(searchReq, env)
    expect(searchRes.status).toBe(200)
    const searchBody = await searchRes.json() as Record<string, unknown>
    expect(searchBody.ok).toBe(true)
    const searchResults = searchBody.results as Array<Record<string, unknown>>
    expect(searchResults.some((row) => row.slug === "collection:bitcoin-frogs")).toBe(true)

    const rawReq = new Request("https://ordinalmind.local/api/wiki/tools/get_raw_events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscription_id: "abc123i0" }),
    })
    const rawRes = await worker.fetch(rawReq, env)
    expect(rawRes.status).toBe(200)
    const rawBody = await rawRes.json() as Record<string, unknown>
    expect(rawBody.ok).toBe(true)
    expect(rawBody.event_count).toBe(1)

    const collectionReq = new Request("https://ordinalmind.local/api/wiki/tools/get_collection_context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_slug: "bitcoin-frogs" }),
    })
    const collectionRes = await worker.fetch(collectionReq, env)
    expect(collectionRes.status).toBe(200)
    const collectionBody = await collectionRes.json() as Record<string, unknown>
    expect(collectionBody.ok).toBe(true)
    expect(collectionBody.source).toBe("wiki_db")
    expect(collectionBody.collection_size).toBe(1)
    expect(collectionBody.collection_size_source).toBe("raw_chronicle_events.genesis")

    const lintReq = new Request("https://ordinalmind.local/api/wiki/lint")
    const lintRes = await worker.fetch(lintReq, env)
    expect(lintRes.status).toBe(200)
    const lintBody = await lintRes.json() as Record<string, unknown>
    const summary = lintBody.summary as Record<string, unknown>
    expect(Number(summary.total)).toBeGreaterThan(0)
  })

  it("returns structured 404 when page is missing and DB is available", async () => {
    const env = createEnv({ withDb: true, db: seedDb() })

    const req = new Request("https://ordinalmind.local/api/wiki/inscription:missing")
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("wiki_page_not_found")
  })

  it("does not fail page reads when view count update fails", async () => {
    const db = seedDb()
    db.wikiPages.push({
      slug: "inscription:abc123i0",
      entity_type: "inscription",
      title: "#7",
      summary: "Test summary",
      sections_json: JSON.stringify([]),
      cross_refs_json: JSON.stringify([]),
      source_event_ids_json: JSON.stringify(["ev_genesis_1"]),
      generated_at: "2026-04-28T00:00:00.000Z",
      byok_provider: "openai",
      unverified_count: 0,
      view_count: 0,
      updated_at: "2026-04-28T00:00:00.000Z",
    })
    db.failViewCountUpdate = true

    const env = createEnv({ withDb: true, db })
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/inscription:abc123i0"), env)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.slug).toBe("inscription:abc123i0")
  })
})
