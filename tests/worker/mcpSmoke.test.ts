import { describe, expect, it, vi } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerTools } from "../../src/worker/mcp/tools"
import { getConsolidatedSnapshot } from "../../src/worker/wiki/consolidateEndpoint"
import { type Env } from "../../src/worker/index"

// --- Mock do D1 com suporte a Inserção ---
class FakeD1Database {
  wikiPages: any[] = []
  wikiFts: any[] = []
  consolidatedCache: any[] = []

  prepare(sql: string) {
    const s = sql.toLowerCase()
    return {
      bind: (...params: any[]) => ({
        all: async () => {
          if (s.includes("from wiki_fts")) {
             const query = params[0].replace(/\*/g, "")
             const results = this.wikiFts
               .filter(f => f.title.toLowerCase().includes(query.toLowerCase()))
               .map(f => {
                 const page = this.wikiPages.find(p => p.slug === f.slug)
                 const cache = this.consolidatedCache.find(c => c.collection_slug === f.slug)
                 return page ? { ...page, score: 1, completeness: cache?.completeness ?? 0 } : null
               })
               .filter(Boolean)
             return { results }
          }
          if (s.includes("from consolidated_cache")) {
             return { results: this.consolidatedCache.filter(c => c.collection_slug === params[0]) }
          }
          return { results: [] }
        },
        first: async () => {
          if (s.includes("from consolidated_cache")) {
            return this.consolidatedCache.find(c => c.collection_slug === params[0]) || null
          }
          return null
        },
        run: async () => ({ success: true })
      }),
      run: async () => {
        if (s.includes("insert or ignore into wiki_pages")) {
          // Captura o seed (simplificado para o mock)
          // Na vida real, o trigger do D1 popularia o wiki_fts
        }
        return { success: true }
      }
    }
  }
}

// Mock da função buildConsolidation que é chamada internamente
vi.mock("../../src/worker/wiki/consolidate", () => ({
  buildConsolidation: vi.fn(async (slug) => ({
    completeness: { score: 0.1 },
    confidence: 0.5,
    sources: ["test"],
    profile: { name: "Test Collection" },
    narrative: {}
  }))
}))

function createMcpEnv(db: FakeD1Database): Env {
  return {
    ENVIRONMENT: "test",
    MCP_ENABLED: "1",
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    DB: db as any,
    ALLOWED_ORIGINS: "https://ordinalmind.com",
  } as Env
}

describe("Discovery-First Search Smoke Tests", () => {
  
  it("deve criar um seed na wiki_pages quando getConsolidatedSnapshot é chamado com dados", async () => {
    const db = new FakeD1Database()
    const env = createMcpEnv(db)
    
    // Espionamos o prepare para ver se o INSERT foi chamado
    const prepareSpy = vi.spyOn(db, 'prepare')

    await getConsolidatedSnapshot("ordinal-mind", env)
    
    // Verifica se tentou inserir na wiki_pages (o seed)
    expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO wiki_pages"))
  })

  it("wiki_search_collections deve retornar completeness e flag is_seed", async () => {
    const db = new FakeD1Database()
    // Simulamos um estado onde existe um seed no banco
    db.wikiPages.push({ slug: "ordinal-mind", title: "Ordinal Mind", entity_type: "collection", summary: "" })
    db.wikiFts.push({ slug: "ordinal-mind", title: "Ordinal Mind" })
    db.consolidatedCache.push({ collection_slug: "ordinal-mind", completeness: 0.1 })

    const env = createMcpEnv(db)
    const server = new McpServer({ name: "test", version: "1.0.0" })
    
    let searchHandler: any;
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = (name: string, schema: any, handler: any) => {
      if (name === "wiki_search_collections") searchHandler = handler;
      return originalRegister(name, schema, handler);
    };

    registerTools({ server, env, request: new Request("https://mcp.local") })

    const result: any = await searchHandler({ query: "ordinal", limit: 5, offset: 0 })
    
    const item = result.structuredContent.items[0]
    expect(item.slug).toBe("ordinal-mind")
    expect(item.completeness).toBe(0.1)
    expect(item.is_seed).toBe(true)
    expect(item.summary).toContain("Discovery Draft")
  })
})
