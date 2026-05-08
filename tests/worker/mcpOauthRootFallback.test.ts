import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"

function makeEnv(): Env {
  return {
    CHRONICLES_KV: { get: async () => null, put: async () => {} } as any,
    ASSETS: { fetch: async () => new Response("ok") },
    ENVIRONMENT: "test",
    MCP_ENABLED: "1",
    MCP_OAUTH_ENABLED: "1",
  } as Env
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as ExecutionContext
}

describe("MCP OAuth root fallback routing", () => {
  it("rewrites root authorize-like request to /mcp/oauth/authorize", async () => {
    const req = new Request("https://ordinalmind.com/?response_type=code&client_id=test-client&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=wiki.contribute&state=abc&code_challenge=xyz&code_challenge_method=S256")
    const res = await worker.fetch(req, makeEnv(), makeCtx())

    expect(res.status).toBe(307)
    const location = res.headers.get("location")
    expect(location).toContain("/mcp/oauth/authorize?")
  })

  it("rewrites root callback-like request to /mcp/oauth/callback", async () => {
    const req = new Request("https://ordinalmind.com/?code=discord-code&state=abc")
    const res = await worker.fetch(req, makeEnv(), makeCtx())

    expect(res.status).toBe(307)
    const location = res.headers.get("location")
    expect(location).toContain("/mcp/oauth/callback?")
  })
})

