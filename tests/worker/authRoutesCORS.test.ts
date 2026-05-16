import { describe, expect, it } from "vitest"
import worker, { type Env } from "../../src/worker/index"
import { signJWT } from "../../src/worker/auth/jwt"

function createEnv(): Env {
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
    JWT_SECRET: "test-secret-auth-routes",
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await signJWT(
    {
      sub: "community-user",
      username: "collector.ana",
      avatar: null,
      tier: "community",
    },
    "test-secret-auth-routes"
  )

  return { Authorization: `Bearer ${token}` }
}

describe("auth route CORS hardening", () => {
  it("keeps auth/me readable for originless bearer clients", async () => {
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/auth/me", {
      headers: await authHeader(),
    }), createEnv())

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it("reflects allowed origin for auth/me instead of wildcard", async () => {
    const env = createEnv()
    env.ALLOWED_ORIGINS = "https://app.ordinalmind.test"

    const res = await worker.fetch(new Request("https://ordinalmind.local/api/auth/me", {
      headers: {
        ...(await authHeader()),
        Origin: "https://app.ordinalmind.test",
      },
    }), env)

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.ordinalmind.test")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })

  it("does not expose wildcard CORS for untrusted auth/me origins", async () => {
    const res = await worker.fetch(new Request("https://ordinalmind.local/api/auth/me", {
      headers: {
        ...(await authHeader()),
        Origin: "https://evil.example",
      },
    }), createEnv())

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
