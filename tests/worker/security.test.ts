import { describe, expect, it } from "vitest"
import { attachSecurityHeaders, enforceRateLimit } from "../../src/worker/security"

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
