import { describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerTools } from "../../src/worker/mcp/tools"
import { registerResources } from "../../src/worker/mcp/resources"
import { getConsolidatedSnapshot } from "../../src/worker/wiki/consolidateEndpoint"
import { type Env } from "../../src/worker/index"

class FakeD1Database {
  wikiPages: Array<{
    slug: string
    title: string
    entity_type: string
    summary: string
    updated_at?: string | null
    byok_provider?: string
    sections_json?: string
    source_event_ids_json?: string
  }> = []
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
          const query = String(params[0] ?? "").replace(/\*/g, "").toLowerCase()
          const entityFilter = s.includes("and wp.entity_type = ?")
            ? String(params[1] ?? "")
            : null
          const total = this.wikiFts
            .map((fts) => {
              const page = this.wikiPages.find((p) => p.slug === fts.slug)
              if (!page) return null
              if (query && !fts.title.toLowerCase().includes(query)) return null
              if (entityFilter && page.entity_type !== entityFilter) return null
              return fts.slug
            })
            .filter(Boolean).length
          return { results: [{ total }] }
        }
        const query = String(params[0] ?? "").replace(/\*/g, "")
        const entityFilter = s.includes("and wp.entity_type = ?")
          ? String(params[1] ?? "")
          : null
        const results = this.wikiFts
          .filter((f) => f.title.toLowerCase().includes(query.toLowerCase()))
          .map((f) => {
            const page = this.wikiPages.find((p) => p.slug === f.slug)
            if (!page) return null
            if (entityFilter && page.entity_type !== entityFilter) return null
            const cache = this.consolidatedCache.find((c) => c.collection_slug === f.slug)
            return { ...page, score: 1, completeness: cache?.completeness ?? 0, unverified_count: 0 }
          })
          .filter(Boolean)
        return { results }
      }
      if (s.includes("count(*) as total") && s.includes("from wiki_pages")) {
        if (s.includes("where byok_provider = 'system_seed'")) {
          const total = this.wikiPages.filter((row) => {
            const byok = row.byok_provider ?? ""
            const summary = row.summary ?? ""
            const sectionsJson = row.sections_json ?? "[]"
            const sourceEventIdsJson = row.source_event_ids_json ?? "[]"
            return byok === "system_seed"
              && summary === ""
              && sectionsJson === "[]"
              && sourceEventIdsJson === "[]"
          }).length
          return { results: [{ total }] }
        }
        if (s.includes("where entity_type = ?")) {
          const entityType = String(params[0] ?? "")
          return {
            results: [{ total: this.wikiPages.filter((row) => row.entity_type === entityType).length }],
          }
        }
        return { results: [{ total: this.wikiPages.length }] }
      }
      if (s.includes("select slug, entity_type, title, summary, updated_at, unverified_count") && s.includes("from wiki_pages")) {
        let rows = [...this.wikiPages]
        if (s.includes("where entity_type = ?")) {
          const entityType = String(params[0] ?? "")
          rows = rows.filter((row) => row.entity_type === entityType)
        }
        rows.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
        return {
          results: rows.map((row) => ({
            slug: row.slug,
            entity_type: row.entity_type,
            title: row.title,
            summary: row.summary,
            updated_at: row.updated_at ?? null,
            unverified_count: 0,
            byok_provider: row.byok_provider ?? null,
            sections_json: row.sections_json ?? "[]",
            source_event_ids_json: row.source_event_ids_json ?? "[]",
          })),
        }
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
      if (s.includes("from wiki_pages") && s.includes("where slug = ?") && s.includes("limit 1")) {
        const slug = String(params[0] ?? "")
        const page = this.wikiPages.find((row) => row.slug === slug)
        if (!page) return null
        return {
          slug: page.slug,
          entity_type: page.entity_type,
          title: page.title,
          summary: page.summary,
          sections_json: page.sections_json ?? JSON.stringify([]),
          cross_refs_json: JSON.stringify([]),
          source_event_ids_json: page.source_event_ids_json ?? JSON.stringify([]),
          generated_at: page.updated_at ?? "2026-05-07T00:00:00.000Z",
          byok_provider: page.byok_provider ?? "test",
          unverified_count: 0,
          view_count: 0,
          updated_at: page.updated_at ?? null,
        }
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

function captureResourceHandlers(
  server: McpServer,
  targetNames: string[]
): Record<string, (uri: URL, params: Record<string, unknown>) => Promise<{ contents: Array<{ text: string }> }>> {
  const handlers = new Map<string, (uri: URL, params: Record<string, unknown>) => Promise<{ contents: Array<{ text: string }> }>>()
  const originalRegister = server.registerResource.bind(server)

  server.registerResource = ((name: string, template: unknown, metadata: unknown, handler: (uri: URL, params: Record<string, unknown>) => Promise<{ contents: Array<{ text: string }> }>) => {
    if (targetNames.includes(name)) {
      handlers.set(name, handler)
    }
    return originalRegister(name, template as never, metadata as never, handler as never)
  }) as typeof server.registerResource

  return new Proxy({} as Record<string, (uri: URL, params: Record<string, unknown>) => Promise<{ contents: Array<{ text: string }> }>>, {
    get: (_, prop: string) => {
      const handler = handlers.get(prop)
      if (!handler) throw new Error(`resource_handler_not_captured:${prop}`)
      return handler
    },
  })
}

describe("Discovery-first and wiki stats MCP smoke", () => {
  it("deve criar um seed na wiki_pages quando getConsolidatedSnapshot é chamado com dados", async () => {
    const db = new FakeD1Database()
    const env = createMcpEnv(db)
    const prepareSpy = vi.spyOn(db, "prepare")

    await getConsolidatedSnapshot("ordinalmind", env)

    expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO wiki_pages"))
  })

  it("wiki_stats retorna contagens globais e updated_at com fallback para created_at", async () => {
    const db = new FakeD1Database()
    db.contributionHasUpdatedAt = false
    db.wikiPages.push(
      {
        slug: "collection:ordinalmind",
        title: "OrdinalMind",
        entity_type: "collection",
        summary: "",
        updated_at: "2026-05-07T10:00:00.000Z",
        byok_provider: "system_seed",
        sections_json: "[]",
        source_event_ids_json: "[]",
      },
      {
        slug: "node-monkes",
        title: "Node Monkes",
        entity_type: "collection",
        summary: "seed",
        updated_at: "2026-05-07T12:00:00.000Z",
      }
    )
    db.wikiPages.push({
      slug: "inscription:abc123i0",
      title: "Inscription #1",
      entity_type: "inscription",
      summary: "inscription seed",
      updated_at: "2026-05-07T11:30:00.000Z",
    })
    db.wikiFts.push({ slug: "collection:ordinalmind", title: "OrdinalMind" })
    db.wikiFts.push({ slug: "inscription:abc123i0", title: "Inscription #1" })
    db.wikiContributions.push(
      { collection_slug: "ordinalmind", status: "published", created_at: "2026-05-07T13:00:00.000Z" },
      { collection_slug: "ordinalmind", status: "published", created_at: "2026-05-07T13:30:00.000Z" },
      { collection_slug: "node-monkes", status: "published", created_at: "2026-05-07T14:00:00.000Z" },
      { collection_slug: "quantum-cats", status: "quarantine", created_at: "2026-05-07T14:30:00.000Z" },
      { collection_slug: "quantum-cats", status: "quarantine", created_at: "2026-05-07T15:00:00.000Z" },
      { collection_slug: "node-monkes", status: "duplicate", created_at: "2026-05-07T16:00:00.000Z" }
    )

    const env = createMcpEnv(db)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const handlers = captureHandlers(server, ["wiki_stats", "help", "wiki_list_pages", "wiki_search_pages", "wiki_get_page", "wiki_list_fields"])
    registerTools({ server, env, request: new Request("https://mcp.local") })

    const statsResult = await handlers.wiki_stats({})
    const stats = statsResult.structuredContent as Record<string, any>
    expect(stats.ok).toBe(true)
    expect(stats.total_pages).toBe(3)
    expect(stats.indexed_pages).toBe(2)
    expect(stats.published_pages).toBe(2)
    expect(stats.published_contribution_pages).toBe(2)
    expect(stats.quarantine_pages).toBe(1)
    expect(stats.seed_pages).toBe(1)
    expect(stats.published_shape_pages).toBe(2)
    expect(stats.inventory_pages).toBe(3)
    expect(stats.inventory_editorial_pages).toBe(2)
    expect(stats.updated_at).toBe("2026-05-07T15:00:00.000Z")

    const helpResult = await handlers.help({})
    const help = helpResult.structuredContent as Record<string, any>
    expect(help.oauth_mcp?.endpoints?.authorize).toBe("/mcp/oauth/authorize")
    expect(help.oauth_mcp?.endpoints?.token).toBe("/mcp/oauth/token")
    expect(Array.isArray(help.oauth_mcp?.flow)).toBe(true)
    expect(help.oauth_mcp?.request_contracts?.token?.content_type).toBe("application/x-www-form-urlencoded")
    expect(help.oauth_mcp?.request_contracts?.register?.required).toContain("redirect_uris (at least one)")
    expect(Array.isArray(help.oauth_mcp?.troubleshooting?.oauth_provider_unavailable_503)).toBe(true)
    expect(Array.isArray(help.oauth_mcp?.troubleshooting?.state_expired_callback_400)).toBe(true)
    const readOnly = help.available_tools_now.read_only as string[]
    expect(readOnly).toContain("wiki_stats")
    expect(readOnly).toContain("wiki_search_pages")
    expect(readOnly).toContain("wiki_list_pages")
    expect(readOnly).toContain("wiki_get_page")
    expect(readOnly).toContain("wiki_list_fields")
    expect(readOnly).not.toContain("wiki_search_collections")

    const listResult = await handlers.wiki_list_pages({ limit: 10, offset: 0 })
    const list = listResult.structuredContent as Record<string, any>
    expect(list.ok).toBe(true)
    expect(list.total).toBe(3)
    expect(list.items.some((item: Record<string, unknown>) => item.slug === "inscription:abc123i0")).toBe(true)
    const seedItem = list.items.find((item: Record<string, unknown>) => item.slug === "collection:ordinalmind")
    expect(seedItem.publication_status).toBe("seed")
    expect(seedItem.is_seed).toBe(true)

    const searchResult = await handlers.wiki_search_pages({ query: "inscription", limit: 10, offset: 0 })
    const search = searchResult.structuredContent as Record<string, any>
    expect(search.ok).toBe(true)
    expect(search.items.some((item: Record<string, unknown>) => item.entity_type === "inscription")).toBe(true)
    const searchInscription = search.items.find((item: Record<string, unknown>) => item.entity_type === "inscription")
    expect(searchInscription.publication_status).toBe("published")

    const pageResult = await handlers.wiki_get_page({ slug: "inscription:abc123i0" })
    const pageBody = pageResult.structuredContent as Record<string, any>
    expect(pageBody.ok).toBe(true)
    expect(pageBody.publication_status).toBe("published")
    expect(pageBody.page.slug).toBe("inscription:abc123i0")
    expect(pageBody.page.publication_status).toBe("published")

    const fieldsResult = await handlers.wiki_list_fields({ entity_type: "inscription" })
    const fieldsBody = fieldsResult.structuredContent as Record<string, any>
    expect(fieldsBody.ok).toBe(true)
    expect(Array.isArray(fieldsBody.entities)).toBe(true)
    expect(fieldsBody.entities[0].entity_type).toBe("inscription")
    expect(Array.isArray(fieldsBody.entities[0].fields)).toBe(true)
    expect(fieldsBody.entities[0].fields.length).toBeGreaterThan(0)
  })

  it("wiki://page/{slug} resource retorna payload da página", async () => {
    const db = new FakeD1Database()
    db.wikiPages.push({
      slug: "collection:runestone",
      title: "Runestone",
      entity_type: "collection",
      summary: "runestone summary",
      updated_at: "2026-05-07T12:00:00.000Z",
    })
    const env = createMcpEnv(db)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    const resources = captureResourceHandlers(server, ["wiki-page"])
    registerResources(server, env)

    const response = await resources["wiki-page"](
      new URL("wiki://page/collection%3Arunestone"),
      { slug: "collection:runestone" }
    )
    const payload = JSON.parse(response.contents[0].text) as Record<string, any>
    expect(payload.ok).toBe(true)
    expect(payload.page.slug).toBe("collection:runestone")
    expect(payload.page.publication_status).toBe("published")
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
