import { describe, expect, it, vi } from "vitest"
import { handleMcpAuthorizeRoute, handleMcpCallbackRoute } from "../../src/worker/mcp/oauth"
import type { Env } from "../../src/worker/index"

vi.mock("../../src/worker/auth/discord", () => ({
  buildAuthorizationUrl: vi.fn((params: { state: string }) => (
    `https://discord.com/oauth2/authorize?state=${encodeURIComponent(params.state)}`
  )),
  deriveCodeChallenge: vi.fn(async () => "challenge-123"),
  discordSnowflakeToDate: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")),
  exchangeCode: vi.fn(async () => ({ access_token: "discord-access-token" })),
  fetchDiscordGuilds: vi.fn(async () => ([{ id: "guild-1" }])),
  fetchDiscordUser: vi.fn(async () => ({
    id: "user-1",
    username: "user1",
    global_name: "User One",
    avatar: null,
  })),
  generateCodeVerifier: vi.fn(() => "verifier-123"),
}))

vi.mock("../../src/worker/auth/tierEngine", () => ({
  calculateTier: vi.fn(async () => "community"),
}))

class NeverConsistentKv {
  async get(): Promise<string | null> {
    return null
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

class RecordingKv {
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
  private consumed = new Map<string, { code_fingerprint: string | null; expires_at: number }>()
  private failIssue = false
  private failConsume = false
  private forceExpired = false

  constructor(opts?: { failIssue?: boolean; failConsume?: boolean; forceExpired?: boolean }) {
    this.failIssue = opts?.failIssue ?? false
    this.failConsume = opts?.failConsume ?? false
    this.forceExpired = opts?.forceExpired ?? false
  }

  idFromName(name: string): DurableObjectId {
    return { toString: () => name } as DurableObjectId
  }

  get(): DurableObjectStub {
    const store = this.store
    const failIssue = this.failIssue
    const failConsume = this.failConsume
    const forceExpired = this.forceExpired
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
        const body = init?.body ? JSON.parse(String(init.body)) as any : {}

        if (url.pathname === "/issue") {
          if (failIssue) return new Response(JSON.stringify({ ok: false }), { status: 503 })
          const expiresAt = forceExpired ? Date.now() - 1000 : body.expires_at
          store.set(body.state, { payload: body.payload, expires_at: expiresAt })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }

        if (url.pathname === "/consume") {
          if (failConsume) {
            return new Response(JSON.stringify({ ok: false, cause: "missing" }), { status: 404 })
          }
          const consumedRow = this.consumed.get(body.state)
          if (consumedRow && consumedRow.expires_at > Date.now()) {
            const same = Boolean(
              consumedRow.code_fingerprint
              && body.code_fingerprint
              && consumedRow.code_fingerprint === body.code_fingerprint
            )
            return new Response(
              JSON.stringify({ ok: false, cause: same ? "replay_duplicate" : "replay" }),
              { status: 404 }
            )
          }
          const row = store.get(body.state)
          if (!row) return new Response(JSON.stringify({ ok: false, cause: "missing" }), { status: 404 })
          const now = Date.now()
          store.delete(body.state)
          if (row.expires_at <= now) {
            return new Response(JSON.stringify({ ok: false, cause: "expired" }), { status: 404 })
          }
          this.consumed.set(body.state, {
            code_fingerprint: body.code_fingerprint ?? null,
            expires_at: now + 60_000,
          })
          return new Response(JSON.stringify({ ok: true, payload: row.payload }), { status: 200 })
        }

        return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 })
      },
    } as DurableObjectStub
  }
}

function createEnvWithKv(kv: KVNamespace, stateDo?: DurableObjectNamespace): Env {
  return {
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    OAUTH_KV: kv,
    MCP_OAUTH_STATE_DO: stateDo ?? new FakeStateDoNamespace() as any,
    ASSETS: { fetch: async () => new Response("ok") },
    ENVIRONMENT: "test",
    DISCORD_CLIENT_ID: "discord-client-id",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
  } as Env
}

describe("MCP OAuth callback state handling", () => {
  it("consumes state from durable object and completes callback", async () => {
    const kv = new NeverConsistentKv() as any
    const env = createEnvWithKv(kv, new FakeStateDoNamespace() as any)
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const authReq = new Request("https://ordinalmind.com/mcp/oauth/authorize?response_type=code&client_id=test-client")
    const authRes = await handleMcpAuthorizeRoute(authReq, env, oauthApi as any)
    const state = new URL(authRes.headers.get("Location") ?? "").searchParams.get("state")
    const req = new Request(`https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=${encodeURIComponent(state ?? "")}`)
    const res = await handleMcpCallbackRoute(req, env, oauthApi as any)

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("https://client.example/callback")
  })

  it("returns state expired when state is missing in durable object and legacy fallback", async () => {
    const kv = new NeverConsistentKv() as any
    const env = createEnvWithKv(kv, new FakeStateDoNamespace() as any)
    const oauthApi = {
      parseAuthRequest: vi.fn(),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=state-missing")
    const res = await handleMcpCallbackRoute(req, env, oauthApi as any)
    const text = await res.text()

    expect(res.status).toBe(400)
    expect(text).toContain("MCP OAuth failed")
    expect(text).toContain("Authorization state expired")
  })

  it("recovers state from signed cookie fallback when KV misses", async () => {
    const kvMiss = new NeverConsistentKv() as any
    const env = createEnvWithKv(kvMiss, new FakeStateDoNamespace({ failConsume: true }) as any)
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const authorizeReq = new Request("https://ordinalmind.com/mcp/oauth/authorize?response_type=code&client_id=test")
    const authorizeRes = await handleMcpAuthorizeRoute(authorizeReq, env, oauthApi as any)
    const discordLocation = authorizeRes.headers.get("Location") ?? ""
    const setCookie = authorizeRes.headers.get("Set-Cookie") ?? ""
    const state = new URL(discordLocation).searchParams.get("state")

    expect(authorizeRes.status).toBe(302)
    expect(state).toBeTruthy()
    expect(setCookie).toContain("ordinalmind_mcp_oauth_state=")

    const callbackReq = new Request(
      `https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=${encodeURIComponent(state ?? "")}`,
      { headers: { Cookie: setCookie } }
    )
    const callbackRes = await handleMcpCallbackRoute(callbackReq, env, oauthApi as any)

    expect(callbackRes.status).toBe(302)
    expect(callbackRes.headers.get("Location")).toContain("https://client.example/callback")
    expect(callbackRes.headers.get("Set-Cookie")).toContain("ordinalmind_mcp_oauth_state=;")
  })

  it("blocks replay by consuming state one-time in durable object", async () => {
    const kv = new RecordingKv() as any
    const env = createEnvWithKv(kv, new FakeStateDoNamespace() as any)
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const authorizeReq = new Request("https://ordinalmind.com/mcp/oauth/authorize?response_type=code&client_id=test")
    const authorizeRes = await handleMcpAuthorizeRoute(authorizeReq, env, oauthApi as any)
    const location = authorizeRes.headers.get("Location") ?? ""
    const discordUrl = new URL(location)
    const state = discordUrl.searchParams.get("state")

    expect(authorizeRes.status).toBe(302)
    expect(state).toBeTruthy()

    const callbackReq1 = new Request(
      `https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=${encodeURIComponent(state ?? "")}`
    )
    const callbackRes1 = await handleMcpCallbackRoute(callbackReq1, env, oauthApi as any)
    expect(callbackRes1.status).toBe(302)

    const callbackReq2 = new Request(
      `https://ordinalmind.com/mcp/oauth/callback?code=discord-code-2&state=${encodeURIComponent(state ?? "")}`
    )
    const callbackRes2 = await handleMcpCallbackRoute(callbackReq2, env, oauthApi as any)
    const replayText = await callbackRes2.text()

    expect(callbackRes2.status).toBe(400)
    expect(replayText).toContain("Authorization callback already processed")
  })

  it("returns state expired when durable object entry is already expired", async () => {
    const kv = new NeverConsistentKv() as any
    const env = createEnvWithKv(kv, new FakeStateDoNamespace({ forceExpired: true }) as any)
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const authorizeReq = new Request("https://ordinalmind.com/mcp/oauth/authorize?response_type=code&client_id=test")
    const authorizeRes = await handleMcpAuthorizeRoute(authorizeReq, env, oauthApi as any)
    const state = new URL(authorizeRes.headers.get("Location") ?? "").searchParams.get("state")
    const callbackReq = new Request(
      `https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=${encodeURIComponent(state ?? "")}`
    )
    const callbackRes = await handleMcpCallbackRoute(callbackReq, env, oauthApi as any)
    const text = await callbackRes.text()

    expect(callbackRes.status).toBe(400)
    expect(text).toContain("Authorization state expired")
  })

  it("returns oauth_state_store_unavailable when durable object binding is missing", async () => {
    const env = createEnvWithKv(new RecordingKv() as any)
    delete env.MCP_OAUTH_STATE_DO
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }
    const req = new Request("https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=abc")
    const res = await handleMcpCallbackRoute(req, env, oauthApi as any)
    const body = await res.json() as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body.error).toBe("oauth_state_store_unavailable")
  })
})
