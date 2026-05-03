import { describe, expect, it } from "vitest"
import { decodeJWTPayload } from "../../src/app/lib/byok/jwtClient"

// ---------------------------------------------------------------------------
// jwtClient — client-side JWT decoder (no crypto, browser-safe)
// ---------------------------------------------------------------------------

function buildFakeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  // Fake sig — client-side decoder doesn't verify
  const sig = btoa("fakesig").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  return `${header}.${body}.${sig}`
}

describe("jwtClient — decodeJWTPayload", () => {
  it("decodes valid token payload", () => {
    const token = buildFakeToken({
      sub: "discord_id_123",
      username: "collector42",
      avatar: "https://cdn.discordapp.com/avatars/123/abc.png",
      tier: "og",
      iat: 1700000000,
      exp: 9999999999,
    })

    const payload = decodeJWTPayload(token)
    expect(payload).not.toBeNull()
    expect(payload?.sub).toBe("discord_id_123")
    expect(payload?.username).toBe("collector42")
    expect(payload?.tier).toBe("og")
    expect(payload?.exp).toBe(9999999999)
  })

  it("returns null for token with wrong number of parts", () => {
    expect(decodeJWTPayload("only.two")).toBeNull()
    expect(decodeJWTPayload("one")).toBeNull()
    expect(decodeJWTPayload("")).toBeNull()
  })

  it("returns null for token with invalid base64 payload", () => {
    expect(decodeJWTPayload("header.!!!invalid!!.sig")).toBeNull()
  })

  it("returns null for token with non-JSON payload", () => {
    const bad = btoa("not json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    // "not json" is not valid JSON — but btoa produces a valid base64 string
    // JSON.parse will fail → returns null
    const token = `header.${bad}.sig`
    // "header" is not valid base64url either, but the payload part will fail JSON.parse
    expect(decodeJWTPayload(token)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// KeyStore storage detection helper (hasDiscordJWT logic)
// ---------------------------------------------------------------------------
// We test the exported jwtClient directly; KeyStore integration tested manually.

describe("jwtClient — token expiry detection", () => {
  it("payload with past exp is detectable as expired", () => {
    const now = Math.floor(Date.now() / 1000)
    const token = buildFakeToken({
      sub: "x",
      username: "y",
      avatar: null,
      tier: "community",
      iat: now - 200,
      exp: now - 100,
    })
    const payload = decodeJWTPayload(token)
    expect(payload).not.toBeNull()
    expect(payload!.exp < now).toBe(true) // expired
  })

  it("payload with future exp is detectable as valid", () => {
    const now = Math.floor(Date.now() / 1000)
    const token = buildFakeToken({
      sub: "x",
      username: "y",
      avatar: null,
      tier: "og",
      iat: now,
      exp: now + 604800, // 7 days
    })
    const payload = decodeJWTPayload(token)
    expect(payload).not.toBeNull()
    expect(payload!.exp > now).toBe(true) // valid
  })
})
