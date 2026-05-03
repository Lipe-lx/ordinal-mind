import { describe, expect, it, beforeEach } from "vitest"
import { encryptValue, decryptValue, hasDeviceKey, clearDeviceKey } from "../../src/app/lib/keyEncryption"

// Node 18+ provides globalThis.crypto with Web Crypto API — runs natively in vitest.
// localStorage is not available in Node — provide a minimal in-memory mock.
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {}
  // @ts-expect-error - polyfill for node environment
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
  }
}

const TEST_CONFIG = {
  provider: "gemini" as const,
  model: "gemini-2.5-flash",
  key: "AIzaTestKey123456789",
  researchKeys: { braveSearchApiKey: "brave_test" },
}

describe("keyEncryption — AES-256-GCM", () => {
  beforeEach(() => {
    // Clean localStorage state between tests
    clearDeviceKey()
  })

  it("encrypt → decrypt roundtrip preserves original value", async () => {
    const payload = await encryptValue(TEST_CONFIG)

    expect(typeof payload.ct).toBe("string")
    expect(typeof payload.iv).toBe("string")
    expect(payload.ct.length).toBeGreaterThan(0)
    expect(payload.iv.length).toBeGreaterThan(0)

    // Ciphertext must not contain the plaintext key
    expect(atob(payload.ct)).not.toContain("AIzaTestKey123456789")

    const decrypted = await decryptValue<typeof TEST_CONFIG>(payload)
    expect(decrypted).not.toBeNull()
    expect(decrypted?.key).toBe(TEST_CONFIG.key)
    expect(decrypted?.provider).toBe(TEST_CONFIG.provider)
    expect(decrypted?.model).toBe(TEST_CONFIG.model)
    expect(decrypted?.researchKeys?.braveSearchApiKey).toBe("brave_test")
  })

  it("each encryption produces a different ciphertext (IV randomness)", async () => {
    const p1 = await encryptValue(TEST_CONFIG)
    const p2 = await encryptValue(TEST_CONFIG)

    expect(p1.iv).not.toBe(p2.iv)         // IVs must differ
    expect(p1.ct).not.toBe(p2.ct)         // Ciphertexts must differ (different IVs)
  })

  it("device key is persisted (created once, reused on subsequent calls)", async () => {
    expect(hasDeviceKey()).toBe(false)

    const p1 = await encryptValue({ x: 1 })
    expect(hasDeviceKey()).toBe(true)

    // Encrypt and decrypt again — must use the same key
    const p2 = await encryptValue({ x: 1 })
    const d1 = await decryptValue<{ x: number }>(p1)
    const d2 = await decryptValue<{ x: number }>(p2)
    expect(d1?.x).toBe(1)
    expect(d2?.x).toBe(1)
  })

  it("returns null for tampered ciphertext", async () => {
    const payload = await encryptValue(TEST_CONFIG)
    // Tamper: flip some bytes in the base64 ciphertext
    const bytes = atob(payload.ct).split("")
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff)
    const tampered = { ct: btoa(bytes.join("")), iv: payload.iv }

    const result = await decryptValue<typeof TEST_CONFIG>(tampered)
    expect(result).toBeNull()
  })

  it("returns null for tampered IV", async () => {
    const payload = await encryptValue(TEST_CONFIG)
    // Use a different random IV
    const wrongIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    const tampered = { ct: payload.ct, iv: wrongIv }

    const result = await decryptValue<typeof TEST_CONFIG>(tampered)
    expect(result).toBeNull()
  })

  it("clearDeviceKey removes device key from storage", async () => {
    await encryptValue({ x: 1 })
    expect(hasDeviceKey()).toBe(true)

    clearDeviceKey()
    expect(hasDeviceKey()).toBe(false)
  })

  it("encrypts and decrypts non-object primitives", async () => {
    const p = await encryptValue("plain string value")
    const d = await decryptValue<string>(p)
    expect(d).toBe("plain string value")
  })
})
