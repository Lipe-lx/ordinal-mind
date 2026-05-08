import { describe, expect, it } from "vitest"
import { handleMcpAuthorizeRoute } from "../../src/worker/mcp/oauth"
import type { Env } from "../../src/worker/index"

class FakeKv {
  store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

class FakeStateDoNamespace {
  private store = new Map<string, { payload: any; expires_at: number }>()

  idFromName(name: string): DurableObjectId {
    return { toString: () => name } as DurableObjectId
  }

  get(): DurableObjectStub {
    const store = this.store
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
        const body = init?.body ? JSON.parse(String(init.body)) as any : {}
        if (url.pathname === "/issue") {
          store.set(body.state, { payload: body.payload, expires_at: body.expires_at })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        if (url.pathname === "/consume") {
          const row = store.get(body.state)
          if (!row) return new Response(JSON.stringify({ ok: false, cause: "missing" }), { status: 404 })
          store.delete(body.state)
          return new Response(JSON.stringify({ ok: true, payload: row.payload }), { status: 200 })
        }
        return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 })
      },
    } as DurableObjectStub
  }
}

function baseEnv(): Env {
  return {
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    ASSETS: { fetch: async () => new Response("ok") },
    ENVIRONMENT: "test",
    DISCORD_CLIENT_ID: "discord-client-id",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
    OAUTH_KV: new FakeKv() as any,
    MCP_OAUTH_STATE_DO: new FakeStateDoNamespace() as any,
  } as Env
}

describe("MCP OAuth authorize route", () => {
  it("redirects to Discord when provider runtime is available and env is configured", async () => {
    const env = baseEnv()
    const provider = {
      parseAuthRequest: async () => ({ scope: ["wiki.contribute"] } as any),
      completeAuthorization: async () => ({ redirectTo: "https://example.com/cb" }),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/authorize?response_type=code&client_id=test-client")
    const res = await handleMcpAuthorizeRoute(req, env, provider as any)

    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("https://discord.com/oauth2/authorize")
    expect(location).toContain(encodeURIComponent("https://ordinalmind.com/mcp/oauth/callback"))
  })

  it("returns discord_oauth_not_configured when Discord credentials are missing", async () => {
    const env = baseEnv()
    delete env.DISCORD_CLIENT_ID
    const provider = {
      parseAuthRequest: async () => ({ scope: ["wiki.contribute"] } as any),
      completeAuthorization: async () => ({ redirectTo: "https://example.com/cb" }),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/authorize")
    const res = await handleMcpAuthorizeRoute(req, env, provider as any)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body.error).toBe("discord_oauth_not_configured")
  })

  it("returns oauth_kv_not_configured when OAUTH_KV is missing", async () => {
    const env = baseEnv()
    delete env.OAUTH_KV
    const provider = {
      parseAuthRequest: async () => ({ scope: ["wiki.contribute"] } as any),
      completeAuthorization: async () => ({ redirectTo: "https://example.com/cb" }),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/authorize")
    const res = await handleMcpAuthorizeRoute(req, env, provider as any)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body.error).toBe("oauth_kv_not_configured")
  })

  it("returns oauth_provider_unavailable when runtime provider is unavailable", async () => {
    const env = baseEnv()
    const req = new Request("https://ordinalmind.com/mcp/oauth/authorize")
    const res = await handleMcpAuthorizeRoute(req, env, null)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body.error).toBe("oauth_provider_unavailable")
  })

  it("returns oauth_state_store_unavailable when MCP_OAUTH_STATE_DO is missing", async () => {
    const env = baseEnv()
    delete env.MCP_OAUTH_STATE_DO
    const provider = {
      parseAuthRequest: async () => ({ scope: ["wiki.contribute"] } as any),
      completeAuthorization: async () => ({ redirectTo: "https://example.com/cb" }),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/authorize")
    const res = await handleMcpAuthorizeRoute(req, env, provider as any)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body.error).toBe("oauth_state_store_unavailable")
  })
})
