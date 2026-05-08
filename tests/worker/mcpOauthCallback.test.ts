import { describe, expect, it, vi } from "vitest"
import { handleMcpCallbackRoute } from "../../src/worker/mcp/oauth"
import type { Env } from "../../src/worker/index"

vi.mock("../../src/worker/auth/discord", () => ({
  buildAuthorizationUrl: vi.fn(),
  deriveCodeChallenge: vi.fn(),
  discordSnowflakeToDate: vi.fn(() => new Date("2026-01-01T00:00:00.000Z")),
  exchangeCode: vi.fn(async () => ({ access_token: "discord-access-token" })),
  fetchDiscordGuilds: vi.fn(async () => ([{ id: "guild-1" }])),
  fetchDiscordUser: vi.fn(async () => ({
    id: "user-1",
    username: "user1",
    global_name: "User One",
    avatar: null,
  })),
  generateCodeVerifier: vi.fn(),
}))

vi.mock("../../src/worker/auth/tierEngine", () => ({
  calculateTier: vi.fn(async () => "community"),
}))

class EventuallyConsistentKv {
  private reads = 0
  private readonly stateJson: string

  constructor(stateJson: string) {
    this.stateJson = stateJson
  }

  async get(key: string): Promise<string | null> {
    if (!key.startsWith("mcp_oauth_state:")) return null
    this.reads += 1
    if (this.reads === 1) return null
    return this.stateJson
  }

  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

class NeverConsistentKv {
  async get(): Promise<string | null> {
    return null
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

function createEnvWithKv(kv: KVNamespace): Env {
  return {
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    OAUTH_KV: kv,
    ASSETS: { fetch: async () => new Response("ok") },
    ENVIRONMENT: "test",
    DISCORD_CLIENT_ID: "discord-client-id",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
  } as Env
}

describe("MCP OAuth callback state handling", () => {
  it("recovers state with retry when first KV read misses", async () => {
    const pending = {
      created_at: new Date().toISOString(),
      discord_state: "state-123",
      code_verifier: "verifier-123",
      oauth_request: { scope: ["wiki.contribute"] },
    }
    const kv = new EventuallyConsistentKv(JSON.stringify(pending)) as any
    const env = createEnvWithKv(kv)
    const oauthApi = {
      parseAuthRequest: vi.fn(),
      completeAuthorization: vi.fn(async () => ({ redirectTo: "https://client.example/callback?code=abc" })),
    }

    const req = new Request("https://ordinalmind.com/mcp/oauth/callback?code=discord-code-1&state=state-123")
    const res = await handleMcpCallbackRoute(req, env, oauthApi as any)

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("https://client.example/callback")
  })

  it("returns state expired when state is missing after all retry attempts", async () => {
    const kv = new NeverConsistentKv() as any
    const env = createEnvWithKv(kv)
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
})
