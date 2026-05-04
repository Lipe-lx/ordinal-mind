// Client-side JWT utilities (browser-safe).
// Does NOT verify signatures — signature verification happens server-side via /api/auth/me.
// This file only provides client-side decoding for optimistic UI rendering and expiry checks.

export type OGTier = "anon" | "community" | "og" | "genesis"

export interface DiscordBadge {
  name: string
  level: number
}

export interface JWTPayload {
  sub: string
  username: string
  avatar: string | null
  tier: OGTier
  badges?: DiscordBadge[]
  iat: number
  exp: number
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

/**
 * Decode a JWT payload without signature verification.
 * Use only for client-side expiry checks and optimistic UI rendering.
 * Always validate with /api/auth/me before trusting the identity.
 */
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
