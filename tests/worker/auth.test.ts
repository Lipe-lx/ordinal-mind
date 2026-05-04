import { describe, expect, it, vi } from "vitest"
import { signJWT, verifyJWT, decodeJWTPayload } from "../../src/worker/auth/jwt"
import { calculateTier } from "../../src/worker/auth/tierEngine"
import type { OGTier } from "../../src/worker/auth/jwt"

// ---------------------------------------------------------------------------
// Minimal Web Crypto shim for Node test environment
// ---------------------------------------------------------------------------
// Node 18+ has globalThis.crypto — vitest runs with node environment

// ---------------------------------------------------------------------------
// JWT tests
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-jwt-secret-32-chars-long-padded"

describe("JWT — signJWT / verifyJWT", () => {
  it("roundtrip: signed token verifies correctly", async () => {
    const token = await signJWT(
      { sub: "123456", username: "testuser", avatar: null, tier: "community" },
      TEST_SECRET
    )

    expect(token.split(".")).toHaveLength(3)

    const payload = await verifyJWT(token, TEST_SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.sub).toBe("123456")
    expect(payload?.username).toBe("testuser")
    expect(payload?.tier).toBe("community")
    expect(payload?.avatar).toBeNull()
    expect(typeof payload?.iat).toBe("number")
    expect(typeof payload?.exp).toBe("number")
  })

  it("rejects token with wrong secret", async () => {
    const token = await signJWT(
      { sub: "123", username: "x", avatar: null, tier: "anon" },
      TEST_SECRET
    )
    const payload = await verifyJWT(token, "different-secret-entirely")
    expect(payload).toBeNull()
  })

  it("rejects tampered payload", async () => {
    const token = await signJWT(
      { sub: "123", username: "user", avatar: null, tier: "community" },
      TEST_SECRET
    )
    const parts = token.split(".")
    // Replace payload with modified data
    const fakePayload = btoa(JSON.stringify({ sub: "999", username: "hacker", tier: "genesis", iat: 0, exp: 9999999999 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const tampered = `${parts[0]}.${fakePayload}.${parts[2]}`
    const result = await verifyJWT(tampered, TEST_SECRET)
    expect(result).toBeNull()
  })

  it("rejects expired token", async () => {
    const now = Math.floor(Date.now() / 1000)
    // Build a token with exp in the past manually
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const expiredPayload = {
      sub: "123",
      username: "user",
      avatar: null,
      tier: "community" as OGTier,
      iat: now - 200,
      exp: now - 100, // expired 100 seconds ago
    }
    const payloadB64 = btoa(JSON.stringify(expiredPayload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const signingInput = `${header}.${payloadB64}`

    // Sign it properly
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(TEST_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput))
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const expiredToken = `${signingInput}.${sigB64}`

    const result = await verifyJWT(expiredToken, TEST_SECRET)
    expect(result).toBeNull()
  })
})

describe("JWT — decodeJWTPayload", () => {
  it("decodes payload without verification", async () => {
    const token = await signJWT(
      { sub: "abc", username: "alice", avatar: "https://cdn.example.com/a.png", tier: "og" },
      TEST_SECRET
    )
    const payload = decodeJWTPayload(token)
    expect(payload?.sub).toBe("abc")
    expect(payload?.username).toBe("alice")
    expect(payload?.tier).toBe("og")
  })

  it("returns null for malformed token", () => {
    expect(decodeJWTPayload("not.a.token.at.all")).toBeNull()
    expect(decodeJWTPayload("")).toBeNull()
    expect(decodeJWTPayload("a.b")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tier Engine tests
// ---------------------------------------------------------------------------

function makeKV(overrides: Record<string, string> = {}): KVNamespace {
  const store: Record<string, string> = overrides
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
  } as unknown as KVNamespace
}

const OLD_ACCOUNT = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) // 2 years ago
const NEW_ACCOUNT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)       // 30 days ago

describe("Tier Engine — calculateTier", () => {
  it("returns genesis for built-in genesis reviewer fallback", async () => {
    const kv = makeKV({})
    const tier = await calculateTier("747550957432471654", [], NEW_ACCOUNT, kv)
    expect(tier).toBe("genesis")
  })

  it("returns genesis for whitelisted discord_id", async () => {
    const kv = makeKV({
      og_genesis_whitelist: JSON.stringify(["genesis_user_id"]),
    })
    const tier = await calculateTier("genesis_user_id", [], OLD_ACCOUNT, kv)
    expect(tier).toBe("genesis")
  })

  it("returns og for old account + og server membership", async () => {
    const kv = makeKV({
      og_server_config: JSON.stringify({
        og_servers: ["server_og_1"],
        community_servers: ["server_comm_1"],
      }),
    })
    const tier = await calculateTier("user_1", ["server_og_1", "server_other"], OLD_ACCOUNT, kv)
    expect(tier).toBe("og")
  })

  it("returns community (not og) for new account even with og server", async () => {
    const kv = makeKV({
      og_server_config: JSON.stringify({
        og_servers: ["server_og_1"],
        community_servers: [],
      }),
    })
    const tier = await calculateTier("user_2", ["server_og_1"], NEW_ACCOUNT, kv)
    expect(tier).toBe("community")
  })

  it("returns community for any recognized server (community list)", async () => {
    const kv = makeKV({
      og_server_config: JSON.stringify({
        og_servers: ["server_og_1"],
        community_servers: ["server_comm_1"],
      }),
    })
    const tier = await calculateTier("user_3", ["server_comm_1"], OLD_ACCOUNT, kv)
    expect(tier).toBe("community")
  })

  it("returns community as fallback when Discord connected but no recognized server", async () => {
    const kv = makeKV({
      og_server_config: JSON.stringify({
        og_servers: ["server_og_1"],
        community_servers: ["server_comm_1"],
      }),
    })
    const tier = await calculateTier("user_4", ["unrecognized_server"], OLD_ACCOUNT, kv)
    expect(tier).toBe("community")
  })

  it("returns community with empty server list (no config in KV)", async () => {
    const kv = makeKV({}) // no og_server_config key
    const tier = await calculateTier("user_5", [], OLD_ACCOUNT, kv)
    expect(tier).toBe("community")
  })

  it("genesis whitelist takes precedence over everything else", async () => {
    const kv = makeKV({
      og_genesis_whitelist: JSON.stringify(["super_user"]),
      og_server_config: JSON.stringify({ og_servers: ["s1"], community_servers: [] }),
    })
    const tier = await calculateTier("super_user", [], NEW_ACCOUNT, kv)
    expect(tier).toBe("genesis")
  })

  it("handles malformed KV JSON gracefully (falls back to community)", async () => {
    const kv = makeKV({
      og_server_config: "NOT_VALID_JSON",
    })
    const tier = await calculateTier("user_6", ["server_og_1"], OLD_ACCOUNT, kv)
    expect(tier).toBe("community")
  })
})
