import type { Env } from "../index"
import { verifyJWT, type JWTPayload } from "./jwt"

export const AUTH_COOKIE_NAME = "ordinal_mind_auth"

export function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {}
  const pairs = header.split(";")
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    const idx = pair.indexOf("=")
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function getCookie(request: Request, name: string): string | null {
  const cookies = parseCookieHeader(request.headers.get("Cookie"))
  const value = cookies[name]
  return typeof value === "string" && value.length > 0 ? value : null
}

export function getSessionToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token) return token
  }
  return getCookie(request, AUTH_COOKIE_NAME)
}

export function buildAuthCookie(token: string, requestUrl: URL, maxAgeSeconds: number): string {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : ""
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`
}

export function buildClearAuthCookie(requestUrl: URL): string {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : ""
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

export async function requireSessionUser(
  request: Request,
  env: Env
): Promise<{ ok: true; payload: JWTPayload } | { ok: false; status: number; error: string }> {
  if (!env.JWT_SECRET) {
    return { ok: false, status: 503, error: "auth_not_configured" }
  }

  const token = getSessionToken(request)
  if (!token) {
    return { ok: false, status: 401, error: "missing_auth_token" }
  }

  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload) {
    return { ok: false, status: 401, error: "invalid_auth_token" }
  }

  return { ok: true, payload }
}
