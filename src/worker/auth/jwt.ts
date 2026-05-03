// JWT utilities for Discord identity.
// Uses Web Crypto HMAC-SHA256 — no external dependencies.
// Runs natively in Cloudflare Workers runtime.

export type OGTier = "anon" | "community" | "og" | "genesis"

export interface JWTPayload {
  sub: string        // discord_id
  username: string
  avatar: string | null
  tier: OGTier
  iat: number        // issued at (seconds)
  exp: number        // expires at (seconds)
}

const JWT_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function base64urlEncode(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/")
  const padLen = (4 - (padded.length % 4)) % 4
  const b64 = padded + "=".repeat(padLen)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

export async function signJWT(
  payload: Omit<JWTPayload, "iat" | "exp">,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  }

  const header = { alg: "HS256", typ: "JWT" }
  const enc = new TextEncoder()

  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)).buffer as ArrayBuffer)
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(fullPayload)).buffer as ArrayBuffer)
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput))

  return `${signingInput}.${base64urlEncode(sig)}`
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, sigB64] = parts
    const signingInput = `${headerB64}.${payloadB64}`

    const enc = new TextEncoder()
    const key = await importHmacKey(secret)
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(sigB64),
      enc.encode(signingInput)
    )
    if (!valid) return null

    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64))
    const payload = JSON.parse(payloadJson) as JWTPayload

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null // expired

    return payload
  } catch {
    return null
  }
}

/** Decode JWT payload without verification (client-side expiry check only). */
export function decodeJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payloadJson = new TextDecoder().decode(base64urlDecode(parts[1]))
    return JSON.parse(payloadJson) as JWTPayload
  } catch {
    return null
  }
}
