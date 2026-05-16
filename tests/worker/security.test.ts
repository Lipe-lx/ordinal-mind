import { describe, expect, it } from "vitest"
import {
  attachSecurityHeaders,
  buildApiPreflightResponse,
  enforceRateLimit,
} from "../../src/worker/security"

describe("attachSecurityHeaders", () => {
  it("allows ordinals preview framing and external inscription media via CSP", async () => {
    const request = new Request("https://ordinalmind.local/")
    const response = new Response("<html><body>ok</body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })

    const secured = attachSecurityHeaders(request, response, false)
    const csp = secured.headers.get("Content-Security-Policy") ?? ""

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-src 'self' https://ordinals.com")
    expect(csp).toContain("media-src 'self' data: blob: https:")
  })

  it("reflects allowed origins for sensitive authenticated routes instead of wildcard", () => {
    const request = new Request("https://ordinalmind.local/api/auth/me", {
      headers: { Origin: "https://ordinalmind.local" },
    })
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })

    const secured = attachSecurityHeaders(request, response, false)
    expect(secured.headers.get("Access-Control-Allow-Origin")).toBe("https://ordinalmind.local")
    expect(secured.headers.get("Access-Control-Allow-Credentials")).toBe("true")
    expect(secured.headers.get("Vary")).toContain("Origin")
  })

  it("removes wildcard CORS from sensitive originless responses while keeping the body readable server-side", async () => {
    const request = new Request("https://ordinalmind.local/api/wiki/export")
    const response = new Response("zip-bytes", {
      headers: {
        "Content-Type": "application/zip",
        "Access-Control-Allow-Origin": "*",
      },
    })

    const secured = attachSecurityHeaders(request, response, false)
    expect(secured.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await secured.text()).toBe("zip-bytes")
  })
})

describe("buildApiPreflightResponse", () => {
  it("blocks sensitive preflight requests from disallowed origins", () => {
    const response = buildApiPreflightResponse(new Request("https://ordinalmind.local/api/wiki/contribute", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    }))

    expect(response.status).toBe(403)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("reflects allowed origin on sensitive preflight requests", () => {
    const response = buildApiPreflightResponse(new Request("https://ordinalmind.local/api/wiki/contribute", {
      method: "OPTIONS",
      headers: {
        Origin: "https://ordinalmind.local",
        "Access-Control-Request-Method": "POST",
      },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ordinalmind.local")
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })
})

describe("enforceRateLimit", () => {
  it("fails open when KV write quota is exhausted", async () => {
    const kv = {
      get: async () => "0",
      put: async () => {
        throw new Error("KV put() limit exceeded for the day.")
      },
    } as unknown as KVNamespace

    const result = await enforceRateLimit(kv, new Request("https://ordinalmind.local/api/wiki/reviews/pending"), {
      keyPrefix: "test",
      limit: 5,
      windowSeconds: 60,
    })

    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(result.remaining).toBe(4)
  })
})
