import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"

class FakeD1Statement {
  constructor(
    private readonly rows: Array<{ slug: string; entity_type: string }>,
    private readonly sql: string
  ) {}

  bind(..._params: unknown[]): FakeD1Statement {
    return this
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes("SELECT slug, entity_type FROM wiki_pages")) {
      return { results: this.rows as T[] }
    }
    return { results: [] }
  }

  async first<T>(): Promise<T | null> {
    return null
  }
}

class FakeD1Database {
  constructor(private readonly rows: Array<{ slug: string; entity_type: string }>) {}

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this.rows, sql)
  }
}

function createEnv(options?: {
  assetText?: string
  dbRows?: Array<{ slug: string; entity_type: string }>
}): Env {
  const kvStore = new Map<string, string>()
  return {
    CHRONICLES_KV: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    } as unknown as KVNamespace,
    ASSETS: {
      fetch: async (request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === "/llms.txt") {
          return new Response(options?.assetText ?? "llms-content", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        }

        return new Response("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      },
    },
    ENVIRONMENT: "test",
    DB: options?.dbRows ? (new FakeD1Database(options.dbRows) as unknown as D1Database) : undefined,
  }
}

describe("public SEO and agent routes", () => {
  it("serves enriched static home HTML to bot user agents", async () => {
    const response = await worker.fetch(
      new Request("https://ordinalmind.local/", {
        headers: { "user-agent": "Claude-Web/1.0" },
      }),
      createEnv()
    )

    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SEO-Cache")).toBe("miss")
    expect(body).toContain("Factual first memory engine for Bitcoin Ordinals")
    expect(body).toContain("Accepted Inputs")
    expect(body).toContain("/llms.txt")
    expect(body).toContain("/mcp")
  })

  it("keeps the SPA shell for normal browser user agents", async () => {
    const response = await worker.fetch(
      new Request("https://ordinalmind.local/", {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      createEnv()
    )

    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SEO-Cache")).toBeNull()
    expect(body).toContain("<div id=\"root\"></div>")
    expect(body).not.toContain("Accepted Inputs")
  })

  it("serves richer docs HTML to bot user agents", async () => {
    const response = await worker.fetch(
      new Request("https://ordinalmind.local/docs", {
        headers: { "user-agent": "GPTBot/1.0" },
      }),
      createEnv()
    )

    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain("Documentation")
    expect(body).toContain("Agent Layer (MCP)")
    expect(body).toContain("GET /api/chronicle?id=...")
  })

  it("keeps llms.txt, robots.txt, and sitemap.xml publicly accessible", async () => {
    const env = createEnv({ assetText: "llms-agent-contract" })

    const [llms, robots, sitemap] = await Promise.all([
      worker.fetch(new Request("https://ordinalmind.local/llms.txt"), env),
      worker.fetch(new Request("https://ordinalmind.local/robots.txt"), env),
      worker.fetch(new Request("https://ordinalmind.local/sitemap.xml"), env),
    ])

    expect(await llms.text()).toContain("llms-agent-contract")
    expect(await robots.text()).toContain("User-agent: ClaudeBot")
    expect(await sitemap.text()).toContain("https://ordinalmind.com/docs")
  })

  it("deduplicates sitemap entries and skips bogus collection slugs that are inscription ids", async () => {
    const env = createEnv({
      dbRows: [
        { slug: "collection:runestone", entity_type: "collection" },
        { slug: "collection:runestone", entity_type: "collection" },
        { slug: "inscription:abc123", entity_type: "inscription" },
        {
          slug: `collection:${"a".repeat(64)}i0`,
          entity_type: "collection",
        },
      ],
    })

    const response = await worker.fetch(new Request("https://ordinalmind.local/sitemap.xml"), env)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain("https://ordinalmind.com/docs")
    expect(body.match(/https:\/\/ordinalmind\.com\/wiki\/collection\/runestone/g)?.length ?? 0).toBe(1)
    expect(body).toContain("https://ordinalmind.com/wiki/inscription/abc123")
    expect(body).toContain("https://ordinalmind.com/chronicle/abc123")
    expect(body).not.toContain(`/wiki/collection/${"a".repeat(64)}i0`)
  })
})
