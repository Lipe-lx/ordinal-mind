import { describe, expect, it } from "vitest"
import { persistRawEvents } from "../../src/worker/wiki/persistEvents"
import type { Env } from "../../src/worker/index"
import type { ChronicleEvent } from "../../src/app/lib/types"

class FakeD1Database {
  rows: Array<Record<string, unknown>> = []
  schemaObjects: Set<string>

  constructor(schemaObjects: string[] = [
    "raw_chronicle_events",
    "wiki_pages",
    "wiki_log",
    "wiki_fts",
    "wiki_contributions",
    "consolidated_cache",
  ]) {
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
    const normalized = this.sql.toLowerCase().replace(/\s+/g, " ")
    if (normalized.includes("from sqlite_schema")) {
      return {
        results: this.params
          .map((name) => String(name))
          .filter((name) => this.db.schemaObjects.has(name))
          .map((name) => ({ name })) as T[],
      }
    }
    return { results: [] }
  }

  async run(): Promise<{ success: boolean }> {
    const [id, inscriptionId, eventType, timestamp, blockHeight, sourceType, sourceRef, description, metadataJson] = this.params
    const exists = this.db.rows.some((row) => String(row.id) === String(id))
    if (!exists) {
      this.db.rows.push({
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
    return { success: true }
  }
}

function createEnv(db: FakeD1Database): Env {
  return {
    CHRONICLES_KV: {} as KVNamespace,
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    ENVIRONMENT: "test",
    DB: db as unknown as D1Database,
  }
}

describe("persistRawEvents", () => {
  it("uses insert-or-ignore semantics and avoids duplicates", async () => {
    const db = new FakeD1Database()
    const env = createEnv(db)

    const events: ChronicleEvent[] = [
      {
        id: "ev_a",
        event_type: "genesis",
        timestamp: "2024-01-01T00:00:00.000Z",
        block_height: 800000,
        source: { type: "onchain", ref: "tx1" },
        description: "Genesis",
        metadata: {},
      },
      {
        id: "ev_a",
        event_type: "genesis",
        timestamp: "2024-01-01T00:00:00.000Z",
        block_height: 800000,
        source: { type: "onchain", ref: "tx1" },
        description: "Genesis",
        metadata: {},
      },
    ]

    const result = await persistRawEvents(env, "abc123i0", events)
    expect(result.ok).toBe(true)
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].id).toBe("ev_a")
    expect(db.rows[0].inscription_id).toBe("abc123i0")
  })

  it("returns a fail-soft result when the local D1 wiki schema is missing", async () => {
    const db = new FakeD1Database([])
    const env = createEnv(db)

    const events: ChronicleEvent[] = [
      {
        id: "ev_a",
        event_type: "genesis",
        timestamp: "2024-01-01T00:00:00.000Z",
        block_height: 800000,
        source: { type: "onchain", ref: "tx1" },
        description: "Genesis",
        metadata: {},
      },
    ]

    const result = await persistRawEvents(env, "abc123i0", events)

    expect(result.ok).toBe(false)
    expect(result.status).toBe("schema_missing")
    expect(db.rows).toHaveLength(0)
  })
})
