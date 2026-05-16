import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"
import { signJWT } from "../../src/worker/auth/jwt"

type ContributionRow = {
  id: string
  collection_slug: string
  field: string
  value: string
  confidence: string
  verifiable: number
  contributor_id: string | null
  og_tier: string
  session_id: string
  source_excerpt: string | null
  status: string
  created_at: string
  reviewed_at: string | null
}

type UserRow = {
  discord_id: string
  username: string
}

class ReviewDb {
  wikiContributions: ContributionRow[] = []
  users: UserRow[] = []
  deletedCacheSlugs: string[] = []

  prepare(sql: string): ReviewStatement {
    return new ReviewStatement(this, sql)
  }
}

class ReviewStatement {
  private params: unknown[] = []

  constructor(
    private db: ReviewDb,
    private sql: string
  ) {}

  bind(...params: unknown[]): ReviewStatement {
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

  private execSelect(): Record<string, unknown>[] {
    const sql = this.norm()

    if (sql.includes("select count(*) as count from wiki_contributions where status = 'quarantine'")) {
      return [{
        count: this.db.wikiContributions.filter((item) => item.status === "quarantine").length,
      }]
    }

    if (sql.includes("from wiki_contributions wc") && sql.includes("where wc.status = 'quarantine'")) {
      const limit = Number(this.params[0] ?? 50)
      return this.db.wikiContributions
        .filter((item) => item.status === "quarantine")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((item) => {
          const user = this.db.users.find((entry) => entry.discord_id === item.contributor_id)
          const current = this.db.wikiContributions
            .filter((entry) => entry.collection_slug === item.collection_slug && entry.field === item.field && entry.status === "published")
            .sort((a, b) => tierWeight(b.og_tier) - tierWeight(a.og_tier) || b.created_at.localeCompare(a.created_at))[0]

          return {
            ...item,
            contributor_username: user?.username ?? null,
            current_value: current?.value ?? null,
            current_tier: current?.og_tier ?? null,
          }
        })
    }

    if (sql.includes("from wiki_contributions") && sql.includes("where id = ?") && sql.includes("and status = 'quarantine'")) {
      const reviewId = String(this.params[0] ?? "")
      const row = this.db.wikiContributions.find((item) => item.id === reviewId && item.status === "quarantine")
      return row ? [row] : []
    }

    return []
  }

  private execMutate(): void {
    const sql = this.norm()

    if (sql.includes("update wiki_contributions") && sql.includes("set status = ?, reviewed_at = datetime('now')")) {
      const nextStatus = String(this.params[0] ?? "")
      const reviewId = String(this.params[1] ?? "")
      const row = this.db.wikiContributions.find((item) => item.id === reviewId)
      if (row) {
        row.status = nextStatus
        row.reviewed_at = "now"
      }
      return
    }

    if (sql.includes("delete from consolidated_cache")) {
      const slug = String(this.params[0] ?? "")
      this.db.deletedCacheSlugs.push(slug)
    }
  }
}

function tierWeight(tier: string): number {
  switch (tier) {
    case "genesis":
      return 4
    case "og":
      return 3
    case "community":
      return 2
    default:
      return 1
  }
}

function createEnv(db: ReviewDb): Env {
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
    JWT_SECRET: "test-secret-review-routes",
  }
}

async function authHeader(tier: "genesis" | "og"): Promise<Record<string, string>> {
  const token = await signJWT(
    {
      sub: tier === "genesis" ? "747550957432471654" : "og-reviewer",
      username: tier === "genesis" ? "lipe.lx" : "og-user",
      avatar: null,
      tier,
    },
    "test-secret-review-routes"
  )

  return { Authorization: `Bearer ${token}` }
}

function seedDb(): ReviewDb {
  const db = new ReviewDb()
  db.users.push({ discord_id: "community-1", username: "collector.ana" })
  db.wikiContributions.push(
    {
      id: "wc_published",
      collection_slug: "collection:bitcoin-frogs",
      field: "founder",
      value: "Old canonical founder",
      confidence: "stated_by_user",
      verifiable: 1,
      contributor_id: "og-1",
      og_tier: "og",
      session_id: "session-1",
      source_excerpt: null,
      status: "published",
      created_at: "2026-05-02T10:00:00.000Z",
      reviewed_at: "2026-05-02T10:05:00.000Z",
    },
    {
      id: "wc_pending",
      collection_slug: "collection:bitcoin-frogs",
      field: "founder",
      value: "Casey Rodarmor",
      confidence: "stated_by_user",
      verifiable: 0,
      contributor_id: "community-1",
      og_tier: "community",
      session_id: "session-2",
      source_excerpt: "o founder dessa coleção foi o Casey",
      status: "quarantine",
      created_at: "2026-05-03T10:00:00.000Z",
      reviewed_at: null,
    }
  )
  return db
}

describe("wiki review routes", () => {
  it("lists pending reviews for genesis users", async () => {
    const db = seedDb()
    const env = createEnv(db)
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/pending", {
      headers: await authHeader("genesis"),
    }), env)

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.pending_count).toBe(1)
    const items = body.items as Array<Record<string, unknown>>
    expect(items[0].contributor_username).toBe("collector.ana")
    expect(items[0].current_value).toBe("Old canonical founder")
  })

  it("reflects allowed origin for sensitive review responses instead of wildcard", async () => {
    const db = seedDb()
    const env = createEnv(db)
    env.ALLOWED_ORIGINS = "https://app.ordinalmind.test"

    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/pending", {
      headers: {
        ...(await authHeader("genesis")),
        Origin: "https://app.ordinalmind.test",
      },
    }), env)

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ordinalmind.test")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })

  it("does not expose wildcard CORS on sensitive review responses for untrusted origins", async () => {
    const db = seedDb()
    const env = createEnv(db)
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/pending", {
      headers: {
        ...(await authHeader("genesis")),
        Origin: "https://evil.example",
      },
    }), env)

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("rejects non-genesis reviewers", async () => {
    const db = seedDb()
    const env = createEnv(db)
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/pending", {
      headers: await authHeader("og"),
    }), env)

    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("genesis_review_required")
  })

  it("approves pending reviews and clears consolidated cache", async () => {
    const db = seedDb()
    const env = createEnv(db)
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/wc_pending", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeader("genesis")),
      },
      body: JSON.stringify({ action: "approve" }),
    }), env)

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.status).toBe("published")
    expect(db.wikiContributions.find((item) => item.id === "wc_pending")?.status).toBe("published")
    expect(db.deletedCacheSlugs).toContain("collection:bitcoin-frogs")
  })

  it("rejects pending reviews without publishing them", async () => {
    const db = seedDb()
    const env = createEnv(db)
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/wiki/reviews/wc_pending", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeader("genesis")),
      },
      body: JSON.stringify({ action: "reject" }),
    }), env)

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe("rejected")
    expect(db.wikiContributions.find((item) => item.id === "wc_pending")?.status).toBe("rejected")
    expect(db.deletedCacheSlugs).toHaveLength(0)
  })
})
