import { describe, expect, it, vi } from "vitest"
import {
  handleMcpCallbackRoute,
  handleMcpFlowCancelRoute,
  handleMcpFlowStartRoute,
  handleMcpFlowStatusRoute,
} from "../../src/worker/mcp/oauth"
import type { Env } from "../../src/worker/index"

vi.mock("../../src/worker/auth/discord", () => ({
  buildAuthorizationUrl: vi.fn((params: { state: string }) => (
    `https://discord.com/oauth2/authorize?state=${encodeURIComponent(params.state)}`
  )),
  deriveCodeChallenge: vi.fn(async () => "challenge-xyz"),
  discordSnowflakeToDate: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")),
  exchangeCode: vi.fn(async () => ({ access_token: "discord-access-token" })),
  fetchDiscordGuilds: vi.fn(async () => ([{ id: "guild-1" }])),
  fetchDiscordUser: vi.fn(async () => ({
    id: "user-1",
    username: "user1",
    global_name: "User One",
    avatar: null,
  })),
  generateCodeVerifier: vi.fn(() => "verifier-xyz"),
}))

vi.mock("../../src/worker/auth/tierEngine", () => ({
  calculateTier: vi.fn(async () => "community"),
}))

class FakeKv {
  store = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value) }
  async delete(key: string): Promise<void> { this.store.delete(key) }
}

class FakeStateDoNamespace {
  private states = new Map<string, { payload: any; expires_at: number }>()
  private flows = new Map<string, any>()
  private flowByState = new Map<string, string>()
  private consumed = new Map<string, { code_fingerprint: string | null; expires_at: number }>()

  idFromName(name: string): DurableObjectId {
    return { toString: () => name } as DurableObjectId
  }

  get(): DurableObjectStub {
    const self = this
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
        const body = init?.body ? JSON.parse(String(init.body)) as any : {}

        if (url.pathname === "/issue") {
          self.states.set(body.state, { payload: body.payload, expires_at: body.expires_at })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        if (url.pathname === "/consume") {
          const now = Date.now()
          const consumed = self.consumed.get(body.state)
          if (consumed && consumed.expires_at > now) {
            const same = Boolean(consumed.code_fingerprint && body.code_fingerprint && consumed.code_fingerprint === body.code_fingerprint)
            return new Response(JSON.stringify({ ok: false, cause: same ? "replay_duplicate" : "replay" }), { status: 404 })
          }
          const row = self.states.get(body.state)
          if (!row) return new Response(JSON.stringify({ ok: false, cause: "missing" }), { status: 404 })
          self.states.delete(body.state)
          if (row.expires_at <= now) return new Response(JSON.stringify({ ok: false, cause: "expired" }), { status: 404 })
          self.consumed.set(body.state, { code_fingerprint: body.code_fingerprint ?? null, expires_at: now + 60_000 })
          const flowId = self.flowByState.get(body.state)
          if (flowId) {
            const flow = self.flows.get(flowId)
            if (flow) {
              flow.status = "callback_received"
              flow.updated_at = new Date().toISOString()
              self.flows.set(flowId, flow)
            }
          }
          return new Response(JSON.stringify({ ok: true, payload: row.payload }), { status: 200 })
        }
        if (url.pathname === "/flow/start") {
          const nowIso = new Date().toISOString()
          const flow = {
            flow_id: body.flow_id,
            state: body.state,
            status: "pending",
            created_at: nowIso,
            updated_at: nowIso,
            expires_at: body.expires_at,
            authorize_url: body.authorize_url,
            status_endpoint: body.status_endpoint,
            poll_after_ms: body.poll_after_ms,
          }
          self.flows.set(body.flow_id, flow)
          self.flowByState.set(body.state, body.flow_id)
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        if (url.pathname === "/flow/status") {
          const flow = self.flows.get(body.flow_id)
          if (!flow) return new Response(JSON.stringify({ ok: false, error: "flow_not_found" }), { status: 404 })
          return new Response(JSON.stringify({ ok: true, flow }), { status: 200 })
        }
        if (url.pathname === "/flow/by-state") {
          const flowId = self.flowByState.get(body.state)
          if (!flowId) return new Response(JSON.stringify({ ok: false, error: "flow_not_found" }), { status: 404 })
          const flow = self.flows.get(flowId)
          if (!flow) return new Response(JSON.stringify({ ok: false, error: "flow_not_found" }), { status: 404 })
          return new Response(JSON.stringify({ ok: true, flow }), { status: 200 })
        }
        if (url.pathname === "/flow/update") {
          const flow = self.flows.get(body.flow_id)
          if (!flow) return new Response(JSON.stringify({ ok: false, error: "flow_not_found" }), { status: 404 })
          flow.status = body.status
          flow.updated_at = new Date().toISOString()
          if (body.error || body.hint || body.retryable !== undefined) {
            flow.result = { error: body.error, hint: body.hint, retryable: body.retryable }
          }
          self.flows.set(body.flow_id, flow)
          return new Response(JSON.stringify({ ok: true, flow }), { status: 200 })
        }
        return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 })
      },
    } as DurableObjectStub
  }
}

function makeEnv(): Env {
  return {
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    OAUTH_KV: new FakeKv() as any,
    MCP_OAUTH_STATE_DO: new FakeStateDoNamespace() as any,
    ASSETS: { fetch: async () => new Response("ok") },
    ENVIRONMENT: "test",
    DISCORD_CLIENT_ID: "discord-client-id",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
  } as Env
}

describe("MCP OAuth flow sessions", () => {
  it("creates flow session and returns authorize_url + flow metadata", async () => {
    const env = makeEnv()
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(),
    }
    const req = new Request("https://ordinalmind.com/mcp/oauth/flow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "client-1",
        redirect_uri: "https://example.com/callback",
        scope: "wiki.contribute",
        resource: "https://ordinalmind.com",
      }),
    })
    const res = await handleMcpFlowStartRoute(req, env, oauthApi as any)
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.flow_id).toBeTruthy()
    expect(body.authorize_url).toContain("https://discord.com/oauth2/authorize")
    expect(body.status_endpoint).toContain("/mcp/oauth/flow/status")
    expect(body.oauth_client?.code_verifier).toBeTruthy()
    expect(body.oauth_client?.state).toBeTruthy()
  })

  it("status reflects token_ready after successful callback", async () => {
    const env = makeEnv()
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://example.com/cb?code=ok" })),
    }
    const startReq = new Request("https://ordinalmind.com/mcp/oauth/flow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "client-1",
        redirect_uri: "https://example.com/callback",
      }),
    })
    const startRes = await handleMcpFlowStartRoute(startReq, env, oauthApi as any)
    const startBody = await startRes.json() as any
    const state = new URL(startBody.authorize_url).searchParams.get("state")
    const cbReq = new Request(`https://ordinalmind.com/mcp/oauth/callback?code=valid-code&state=${encodeURIComponent(state ?? "")}`)
    const cbRes = await handleMcpCallbackRoute(cbReq, env, oauthApi as any)
    expect(cbRes.status).toBe(302)

    const statusReq = new Request(`https://ordinalmind.com/mcp/oauth/flow/status?flow_id=${startBody.flow_id}`)
    const statusRes = await handleMcpFlowStatusRoute(statusReq, env)
    const statusBody = await statusRes.json() as any
    expect(statusRes.status).toBe(200)
    expect(statusBody.flow.status).toBe("token_ready")
  })

  it("cancel marks flow as cancelled", async () => {
    const env = makeEnv()
    const oauthApi = {
      parseAuthRequest: vi.fn(async () => ({ scope: ["wiki.contribute"] })),
      completeAuthorization: vi.fn(),
    }
    const startReq = new Request("https://ordinalmind.com/mcp/oauth/flow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "client-1",
        redirect_uri: "https://example.com/callback",
      }),
    })
    const startRes = await handleMcpFlowStartRoute(startReq, env, oauthApi as any)
    const startBody = await startRes.json() as any

    const cancelReq = new Request("https://ordinalmind.com/mcp/oauth/flow/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: startBody.flow_id }),
    })
    const cancelRes = await handleMcpFlowCancelRoute(cancelReq, env)
    expect(cancelRes.status).toBe(200)

    const statusReq = new Request(`https://ordinalmind.com/mcp/oauth/flow/status?flow_id=${startBody.flow_id}`)
    const statusRes = await handleMcpFlowStatusRoute(statusReq, env)
    const statusBody = await statusRes.json() as any
    expect(statusBody.flow.status).toBe("cancelled")
  })
})
