import { describe, expect, it } from "vitest"
import { attachSecurityHeaders } from "../../src/worker/security"

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
