const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const SAFE_FETCH_SITES = new Set(["same-origin", "none"])
const API_CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
const API_CORS_HEADERS = "Content-Type, Authorization, Mcp-Session-Id"

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase())
}

export function getClientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")
  if (cf) return cf.trim()
  const forwarded = request.headers.get("X-Forwarded-For")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return "unknown"
}

export function buildAllowedOrigins(requestUrl: URL, extraAllowed?: string): Set<string> {
  const allowed = new Set<string>([requestUrl.origin])
  if (!extraAllowed) return allowed
  for (const token of extraAllowed.split(",")) {
    const trimmed = token.trim()
    if (trimmed) allowed.add(trimmed)
  }
  return allowed
}

export function isTrustedWriteRequest(
  request: Request,
  requestUrl: URL,
  extraAllowedOrigins?: string
): boolean {
  if (!isWriteMethod(request.method)) return true

  const allowed = buildAllowedOrigins(requestUrl, extraAllowedOrigins)
  const origin = request.headers.get("Origin")
  if (origin && allowed.has(origin)) return true

  const secFetchSite = request.headers.get("Sec-Fetch-Site")
  if (!origin && secFetchSite && SAFE_FETCH_SITES.has(secFetchSite)) return true

  // Non-browser requests often omit Origin/Sec-Fetch headers.
  if (!origin && !secFetchSite) return true

  return false
}

function appendVaryValue(headers: Headers, value: string): void {
  const current = headers.get("Vary")
  if (!current) {
    headers.set("Vary", value)
    return
  }

  const values = new Set(
    current.split(",")
      .map((token) => token.trim())
      .filter(Boolean)
  )
  values.add(value)
  headers.set("Vary", [...values].join(", "))
}

function isSensitiveApiPath(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/api/")) return false
  if (isWriteMethod(method)) return true

  return pathname.startsWith("/api/auth")
    || pathname === "/api/wiki/export"
    || pathname.startsWith("/api/wiki/reviews")
}

function resolveAllowedCorsOrigin(
  request: Request,
  requestUrl: URL,
  extraAllowedOrigins?: string
): string | null {
  const origin = request.headers.get("Origin")
  if (!origin) return null
  const allowed = buildAllowedOrigins(requestUrl, extraAllowedOrigins)
  return allowed.has(origin) ? origin : null
}

export function applyApiCorsHeaders(
  request: Request,
  headers: Headers,
  extraAllowedOrigins?: string
): void {
  const requestUrl = new URL(request.url)
  if (!requestUrl.pathname.startsWith("/api/")) return

  headers.set("Access-Control-Allow-Methods", API_CORS_METHODS)
  headers.set("Access-Control-Allow-Headers", API_CORS_HEADERS)

  if (!isSensitiveApiPath(requestUrl.pathname, request.method)) {
    if (!headers.has("Access-Control-Allow-Origin")) {
      headers.set("Access-Control-Allow-Origin", "*")
    }
    return
  }

  appendVaryValue(headers, "Origin")
  const allowedOrigin = resolveAllowedCorsOrigin(request, requestUrl, extraAllowedOrigins)
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin)
    headers.set("Access-Control-Allow-Credentials", "true")
    return
  }

  headers.delete("Access-Control-Allow-Origin")
  headers.delete("Access-Control-Allow-Credentials")
}

export function buildApiPreflightResponse(
  request: Request,
  extraAllowedOrigins?: string
): Response {
  const requestUrl = new URL(request.url)
  const requestedMethod = request.headers.get("Access-Control-Request-Method") ?? request.method
  const headers = new Headers()
  headers.set("Access-Control-Allow-Methods", API_CORS_METHODS)
  headers.set("Access-Control-Allow-Headers", API_CORS_HEADERS)

  if (!requestUrl.pathname.startsWith("/api/")) {
    headers.set("Access-Control-Allow-Origin", "*")
    return new Response(null, { status: 204, headers })
  }

  if (!isSensitiveApiPath(requestUrl.pathname, requestedMethod)) {
    headers.set("Access-Control-Allow-Origin", "*")
    return new Response(null, { status: 204, headers })
  }

  appendVaryValue(headers, "Origin")
  const allowedOrigin = resolveAllowedCorsOrigin(request, requestUrl, extraAllowedOrigins)
  if (!allowedOrigin) {
    return new Response(null, { status: 403, headers })
  }

  headers.set("Access-Control-Allow-Origin", allowedOrigin)
  headers.set("Access-Control-Allow-Credentials", "true")
  return new Response(null, { status: 204, headers })
}

export interface RateLimitConfig {
  keyPrefix: string
  limit: number
  windowSeconds: number
  alertThreshold?: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
  count: number
}

export async function enforceRateLimit(
  kv: KVNamespace | null | undefined,
  request: Request,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const fallbackOkResult = (): RateLimitResult => ({
    ok: true,
    remaining: Math.max(0, config.limit - 1),
    retryAfterSeconds: Math.max(1, config.windowSeconds),
    count: 1,
  })

  const logFailOpen = (error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "warn",
        event: "security.rate_limit_fail_open",
        keyPrefix: config.keyPrefix,
        detail: detail.slice(0, 220),
      })
    )
  }

  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return fallbackOkResult()
  }

  try {
    const now = Date.now()
    const windowMs = Math.max(1, config.windowSeconds) * 1000
    const bucket = Math.floor(now / windowMs)
    const ip = getClientIp(request)
    const key = `rl:${config.keyPrefix}:${ip}:${bucket}`

    const currentRaw = await kv.get(key)
    const current = currentRaw ? Number.parseInt(currentRaw, 10) || 0 : 0

    if (current >= config.limit) {
      const nextBoundary = (bucket + 1) * windowMs
      const retryAfterSeconds = Math.max(1, Math.ceil((nextBoundary - now) / 1000))
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds,
        count: current,
      }
    }

    const nextCount = current + 1
    await kv.put(key, String(nextCount), {
      expirationTtl: Math.max(config.windowSeconds + 5, 10),
    })

    const nextBoundary = (bucket + 1) * windowMs
    const retryAfterSeconds = Math.max(1, Math.ceil((nextBoundary - now) / 1000))

    if (typeof config.alertThreshold === "number" && nextCount >= config.alertThreshold) {
      console.warn(
        JSON.stringify({
          at: new Date().toISOString(),
          level: "warn",
          event: "security.rate_limit_spike",
          keyPrefix: config.keyPrefix,
          ip,
          count: nextCount,
          limit: config.limit,
        })
      )
    }

    return {
      ok: true,
      remaining: Math.max(0, config.limit - nextCount),
      retryAfterSeconds,
      count: nextCount,
    }
  } catch (error) {
    logFailOpen(error)
    return fallbackOkResult()
  }
}

export function attachSecurityHeaders(
  request: Request,
  response: Response,
  isDev = false,
  extraAllowedOrigins?: string
): Response {
  const headers = new Headers(response.headers)
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("X-Frame-Options", "DENY")
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  )

  const contentType = headers.get("Content-Type") || ""
  if (contentType.includes("text/html")) {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:"
        : "script-src 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "frame-src 'self' https://ordinals.com",
      isDev
        ? "connect-src 'self' http: https: ws: wss:"
        : "connect-src 'self' https: https://cloudflareinsights.com",
      "object-src 'none'",
    ].join("; ")
    headers.set("Content-Security-Policy", csp)
  }

  applyApiCorsHeaders(request, headers, extraAllowedOrigins)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
