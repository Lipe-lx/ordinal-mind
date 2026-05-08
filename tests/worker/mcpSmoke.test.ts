import { describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerTools } from "../../src/worker/mcp/tools"
import { getConsolidatedSnapshot } from "../../src/worker/wiki/consolidateEndpoint"
import { type Env } from "../../src/worker/index"

class FakeD1Database {
  wikiPages: Array<{ slug: string; title: string; entity_type: string; summary: string; updated_at?: string | null }> = []
  wikiFts: Array<{ slug: string; title: string }> = []
  consolidatedCache: Array<{ collection_slug: string; completeness: number }> = []
  wikiContributions: Array<{
    collection_slug: string
    status: "published" | "quarantine" | "duplicate" | "rejected"
    created_at: string
    updated_at?: string
  }> = []
  contributionHasUpdatedAt = false

  prepare(sql: string) {
    const s = sql.toLowerCase()
    const executeAll = async (params: any[]) => {
      if (s.includes("pragma table_info('wiki_contributions')")) {
        const base = [
          { name: "collection_slug" },
          { name: "status" },
          { name: "created_at" },
        ]
        if (this.contributionHasUpdatedAt) base.push({ name: "updated_at" })
        return { results: base }
      }
      if (s.includes("from wiki_fts")) {
        if (s.includes("count(*) as total")) {
          return { results: [{ total: this.wikiFts.length }] }
        }
        const query = String(params[0] ?? "").replace(/\*/g, "")
        const results = this.wikiFts
          .filter((f) => f.title.toLowerCase().includes(query.toLowerCase()))
          .map((f) => {
            const page = this.wikiPages.find((p) => p.slug === f.slug)
            const cache = this.consolidatedCache.find((c) => c.collection_slug === f.slug)
            return page ? { ...page, score: 1, completeness: cache?.completeness ?? 0 } : null
          })
          .filter(Boolean)
        return { results }
      }
      if (s.includes("count(*) as total") && s.includes("from wiki_pages")) {
        return { results: [{ total: this.wikiPages.length }] }
      }
      if (s.includes("count(distinct collection_slug) as total") && s.includes("status = 'published'")) {
        const slugs = new Set(this.wikiContributions
          .filter((row) => row.status === "published")
          .map((row) => row.collection_slug))
        return { results: [{ total: slugs.size }] }
      }
      if (s.includes("count(distinct collection_slug) as total") && s.includes("status = 'quarantine'")) {
        const slugs = new Set(this.wikiContributions
          .filter((row) => row.status === "quarantine")
          .map((row) => row.collection_slug))
        return { results: [{ total: slugs.size }] }
      }
      if (s.includes("max(updated_at) as updated_at") && s.includes("from wiki_pages")) {
        const values = this.wikiPages
          .map((row) => row.updated_at ?? null)
          .filter((value): value is string => typeof value === "string")
        return { results: [{ updated_at: values.length ? values.sort().at(-1) ?? null : null }] }
      }
      if (s.includes("max(updated_at) as updated_at") && s.includes("from wiki_contributions")) {
        if (!this.contributionHasUpdatedAt) {
          throw new Error("D1_ERROR: no such column: updated_at")
        }
        const values = this.wikiContributions
          .filter((row) => row.status === "published" || row.status === "quarantine")
          .map((row) => row.updated_at ?? null)
          .filter((value): value is string => typeof value === "string")
        return { results: [{ updated_at: values.length ? values.sort().at(-1) ?? null : null }] }
      }
      if (s.includes("max(created_at) as updated_at") && s.includes("from wiki_contributions")) {
        const values = this.wikiContributions
          .filter((row) => row.status === "published" || row.status === "quarantine")
          .map((row) => row.created_at)
        return { results: [{ updated_at: values.length ? values.sort().at(-1) ?? null : null }] }
      }
      if (s.includes("from consolidated_cache")) {
        return { results: this.consolidatedCache.filter((c) => c.collection_slug === params[0]) }
      }
      return { results: [] }
    }

    const executeFirst = async (params: any[]) => {
      if (s.includes("from consolidated_cache")) {
        return this.consolidatedCache.find((c) => c.collection_slug === params[0]) || null
      }
      return null
    }

    return {
      bind: (...params: any[]) => ({
        all: async () => executeAll(params),
        first: async () => executeFirst(params),
        run: async () => ({ success: true }),
      }),
      all: async () => executeAll([]),
      first: async () => executeFirst([]),
      run: async () => {
        return { success: true }
      },
    }
  }
}

vi.mock("../../src/worker/wiki/consolidate", () => ({
  buildConsolidation: vi.fn(async (_slug) => ({
    completeness: { score: 0.1 },
    confidence: 0.5,
    sources: ["test"],
    profile: { name: "Test Collection" },
    narrative: {},
  })),
}))

function createMcpEnv(db: FakeD1Database | null): Env {
  return {
    ENVIRONMENT: "test",
    MCP_ENABLED: "1",
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    DB: db as any,
    ALLOWED_ORIGINS: "https://ordinalmind.com",
  } as Env
}

function captureHandlers(
  server: McpServer,
  targetNames: string[]
): Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>()
  const originalRegister = server.registerTool.bind(server)

  server.registerTool = ((name: string, schema: unknown, handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
    if (targetNames.includes(name)) {
      handlers.set(name, handler)
    }
    return originalRegister(name, schema as never, handler as never)
  }) as typeof server.registerTool

  return new Proxy({} as Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>, {
    get: (_, prop: string) => {
      const handler = handlers.get(prop)
      if (!handler) throw new Error(`handler_not_captured:${prop}`)
      return handler
    },
  })
}

describe("Discovery-first and wiki stats MCP smoke", () => {
  it("deve criar um seed na wiki_pages quando getConsolidatedSnapshot é chamado com dados", async () => {
    const db = new FakeD1Database()
    const env = createMcpEnv(db)
    const prepareSpy = vi.spyOn(db, "prepare")

    await getConsolidatedSnapshot("ordinal-mind", env)

    expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO wiki_pages"))
  })

  it("wiki_search_collections deve retornar completeness e flag is_seed", async () => {
    const db = new FakeD1Database()
    db.wikiPages.push({ slug: "ordinal-mind", title: "Ordinal Mind", entity_type: "collection", summary: "" })
    db.wikiFts.push({ slug: "ordinal-mind", title: "Ordinal Mind" })
    db.consolidatedCache.push({ collection_slug: "ordinal-mind", completeness: 0.1 })

    const env = createMcpEnv(db)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const handlers = captureHandlers(server, ["wiki_search_collections"])

    registerTools({ server, env, request: new Request("https://mcp.local") })

    const result = await handlers.wiki_search_collections({ query: "ordinal", limit: 5, offset: 0 })
    const content = result.structuredContent as Record<string, any>

    const item = content.items[0]
    expect(item.slug).toBe("ordinal-mind")
    expect(item.completeness).toBe(0.1)
    expect(item.is_seed).toBe(true)
    expect(item.summary).toContain("Discovery Draft")
  })

  it("wiki_stats retorna contagens globais e updated_at com fallback para created_at", async () => {
    const db = new FakeD1Database()
    db.contributionHasUpdatedAt = false
    db.wikiPages.push(
      {
        slug: "ordinal-mind",
        title: "Ordinal Mind",
        entity_type: "collection",
        summary: "seed",
        updated_at: "2026-05-07T10:00:00.000Z",
      },
      {
        slug: "node-monkes",
        title: "Node Monkes",
        entity_type: "collection",
        summary: "seed",
        updated_at: "2026-05-07T12:00:00.000Z",
      }
    )
    db.wikiFts.push({ slug: "ordinal-mind", title: "Ordinal Mind" })
    db.wikiContributions.push(
      { collection_slug: "ordinal-mind", status: "published", created_at: "2026-05-07T13:00:00.000Z" },
      { collection_slug: "ordinal-mind", status: "published", created_at: "2026-05-07T13:30:00.000Z" },
      { collection_slug: "node-monkes", status: "published", created_at: "2026-05-07T14:00:00.000Z" },
      { collection_slug: "quantum-cats", status: "quarantine", created_at: "2026-05-07T14:30:00.000Z" },
      { collection_slug: "quantum-cats", status: "quarantine", created_at: "2026-05-07T15:00:00.000Z" },
      { collection_slug: "node-monkes", status: "duplicate", created_at: "2026-05-07T16:00:00.000Z" }
    )

    const env = createMcpEnv(db)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const handlers = captureHandlers(server, ["wiki_stats", "help"])
    registerTools({ server, env, request: new Request("https://mcp.local") })

    const statsResult = await handlers.wiki_stats({})
    const stats = statsResult.structuredContent as Record<string, any>
    expect(stats.ok).toBe(true)
    expect(stats.total_pages).toBe(2)
    expect(stats.indexed_pages).toBe(1)
    expect(stats.published_pages).toBe(2)
    expect(stats.quarantine_pages).toBe(1)
    expect(stats.updated_at).toBe("2026-05-07T15:00:00.000Z")

    const helpResult = await handlers.help({})
    const help = helpResult.structuredContent as Record<string, any>
    const readOnly = help.available_tools_now.read_only as string[]
    expect(readOnly).toContain("wiki_stats")
  })

  it("wiki_stats mantém fail-soft quando DB não está disponível", async () => {
    const env = createMcpEnv(null)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const handlers = captureHandlers(server, ["wiki_stats"])
    registerTools({ server, env, request: new Request("https://mcp.local") })

    const result = await handlers.wiki_stats({})
    const body = result.structuredContent as Record<string, unknown>

    expect(body.ok).toBe(false)
    expect(body.error).toBe("wiki_db_unavailable")
  })
})
