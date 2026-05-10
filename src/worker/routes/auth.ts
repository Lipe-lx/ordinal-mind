// Auth routes: Discord OAuth2 + PKCE flow.
// Routes:
//   GET  /api/auth/discord     → initiate OAuth (generate PKCE + state, redirect)
//   GET  /api/auth/callback    → exchange code, compute tier, mint one-time auth code
//   POST /api/auth/exchange    → exchange one-time code for HttpOnly auth cookie
//   GET  /api/auth/me          → verify JWT (header/cookie), return profile
//   POST /api/auth/disconnect  → clear cookie + optional analytics log

import type { Env } from "../index"
import { signJWT } from "../auth/jwt"
import {
  buildAuthorizationUrl,
  deriveCodeChallenge,
  discordSnowflakeToDate,
  exchangeCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  generateCodeVerifier,
} from "../auth/discord"
import { calculateTier, calculateBadges } from "../auth/tierEngine"
import {
  buildAuthCookie,
  buildClearAuthCookie,
  getCookie,
  requireSessionUser,
} from "../auth/session"
import { enforceRateLimit, isTrustedWriteRequest } from "../security"

const PKCE_TTL_SECONDS = 5 * 60 // 5 minutes
const AUTH_CODE_TTL_SECONDS = 90
const AUTH_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days
const PKCE_COOKIE_NAME = "ordinalmind_pkce"

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extraHeaders },
  })
}

function redirect(url: string, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...(extraHeaders ?? {}) },
  })
}

function normalizeAuthPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1)
  }
  return pathname
}

function getFallbackRedirectUri(requestUrl: URL): string {
  return `${requestUrl.origin}/api/auth/callback`
}

function getRedirectUri(requestUrl: URL, env: Env): string {
  const configured = env.DISCORD_REDIRECT_URI?.trim()
  if (configured) {
    try {
      const parsed = new URL(configured)
      const normalizedPath = normalizeAuthPath(parsed.pathname)
      return `${parsed.origin}${normalizedPath}${parsed.search}`
    } catch {
      // Misconfigured value should not break auth entirely.
    }
  }
  return getFallbackRedirectUri(requestUrl)
}

function buildPkceCookie(
  requestUrl: URL,
  payload: { state: string; code_verifier: string; redirect_uri: string }
): string {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : ""
  const raw = encodeURIComponent(JSON.stringify(payload))
  return `${PKCE_COOKIE_NAME}=${raw}; Path=/; Max-Age=${PKCE_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`
}

function buildClearPkceCookie(requestUrl: URL): string {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : ""
  return `${PKCE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

function isDocumentNavigation(request: Request): boolean {
  return request.headers.get("Sec-Fetch-Dest") === "document"
}

function wantsJSON(request: Request): boolean {
  if (isDocumentNavigation(request)) return false
  return request.headers.get("Accept")?.includes("application/json") ?? false
}

async function mintOneTimeAuthCode(env: Env, jwt: string): Promise<string> {
  const authCode = crypto.randomUUID().replace(/-/g, "")
  try {
    await env.CHRONICLES_KV.put(
      `authcode:${authCode}`,
      JSON.stringify({ jwt, created_at: new Date().toISOString() }),
      { expirationTtl: AUTH_CODE_TTL_SECONDS }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("KV put() limit exceeded")) {
      throw new Error("CAPACITY_REACHED", { cause: err })
    }
    throw new Error(msg, { cause: err })
  }
  return authCode
}

function readFragmentParam(fragment: string, name: string): string | null {
  const normalized = fragment.startsWith("#") ? fragment.slice(1) : fragment
  const params = new URLSearchParams(normalized)
  const value = params.get(name)
  return value && value.trim() ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/discord
// Initiates OAuth flow: generate PKCE + state, store in KV, redirect to Discord
// ---------------------------------------------------------------------------
async function handleDiscordInit(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID) {
    return json({ error: "Discord integration not configured." }, 503)
  }
  if (!env.JWT_SECRET) {
    return json({ error: "Discord integration not configured." }, 503)
  }

  const url = new URL(request.url)
  const canonicalRedirectUri = getRedirectUri(url, env)
  const canonicalOrigin = new URL(canonicalRedirectUri).origin
  // Always begin OAuth from the same origin used in redirect_uri.
  // This avoids state being created in one environment (ex: localhost)
  // and validated in another (ex: workers.dev).
  if (url.origin !== canonicalOrigin) {
    return redirect(`${canonicalOrigin}/api/auth/discord`)
  }

  const state = crypto.randomUUID()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)

  const pkceKey = `pkce:${state}`
  const redirectUri = canonicalRedirectUri

  try {
    await env.CHRONICLES_KV.put(
      pkceKey,
      JSON.stringify({
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        created_at: new Date().toISOString(),
      }),
      { expirationTtl: PKCE_TTL_SECONDS }
    )
  } catch (kvErr) {
    const msg = kvErr instanceof Error ? kvErr.message : String(kvErr)
    if (msg.includes("KV put() limit exceeded")) {
      const origin = new URL(redirectUri).origin
      return redirect(`${origin}/#auth_error=CAPACITY_REACHED`)
    }
    throw new Error(msg, { cause: kvErr })
  }

  const authUrl = buildAuthorizationUrl({
    clientId: env.DISCORD_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
  })

  if (wantsJSON(request)) {
    return json({ url: authUrl })
  }

  return redirect(authUrl, {
    "Set-Cookie": buildPkceCookie(url, {
      state,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  })
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/callback
// Receives Discord OAuth code, exchanges for token, computes tier, signs JWT
// ---------------------------------------------------------------------------
async function handleDiscordCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const errorParam = url.searchParams.get("error")

  if (errorParam) {
    if (wantsJSON(request)) {
      return json({ error: errorParam }, 400)
    }
    return redirect(`${url.origin}/#auth_error=${encodeURIComponent(errorParam)}`, {
      "Referrer-Policy": "no-referrer",
    })
  }

  if (!code || !state) {
    return json({ error: "Missing code or state parameter." }, 400)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.JWT_SECRET) {
    return json({ error: "Discord integration not configured." }, 503)
  }

  const pkceKey = `pkce:${state}`
  const pkceRaw = await env.CHRONICLES_KV.get(pkceKey)
  let codeVerifier = ""
  let redirectUri = getRedirectUri(url, env)

  if (pkceRaw) {
    try {
      await env.CHRONICLES_KV.delete(pkceKey)
    } catch {
      // Non-blocking: if delete fails (quota), it will expire anyway.
    }
    try {
      const pkce = JSON.parse(pkceRaw) as { code_verifier: string; redirect_uri?: string }
      codeVerifier = pkce.code_verifier
      if (typeof pkce.redirect_uri === "string" && pkce.redirect_uri.trim().length > 0) {
        redirectUri = pkce.redirect_uri
      }
    } catch {
      return json({ error: "Corrupted PKCE state." }, 500)
    }
  } else {
    const cookieRaw = getCookie(request, PKCE_COOKIE_NAME)
    if (cookieRaw) {
      try {
        const cookiePkce = JSON.parse(cookieRaw) as {
          state?: string
          code_verifier?: string
          redirect_uri?: string
        }
        if (
          typeof cookiePkce.state === "string" &&
          cookiePkce.state === state &&
          typeof cookiePkce.code_verifier === "string" &&
          cookiePkce.code_verifier.length > 0
        ) {
          codeVerifier = cookiePkce.code_verifier
          if (typeof cookiePkce.redirect_uri === "string" && cookiePkce.redirect_uri.trim().length > 0) {
            redirectUri = cookiePkce.redirect_uri
          }
        }
      } catch {
        // Ignore malformed cookie and fallback to the standard error.
      }
    }

    if (!codeVerifier) {
      console.warn(
        JSON.stringify({
          at: new Date().toISOString(),
          event: "security.auth.pkce_missing",
        })
      )
      return json({ error: "Invalid or expired OAuth state. Please try connecting again." }, 400)
    }
  }

  try {
    const tokens = await exchangeCode({
      code,
      codeVerifier,
      redirectUri,
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    })

    const [user, guilds] = await Promise.all([
      fetchDiscordUser(tokens.access_token),
      fetchDiscordGuilds(tokens.access_token),
    ])

    const accountCreatedAt = discordSnowflakeToDate(user.id)
    const guildIds = guilds.map((g) => g.id)
    const tier = await calculateTier(user.id, guildIds, accountCreatedAt, env.CHRONICLES_KV)
    const badges = await calculateBadges(guilds, env.CHRONICLES_KV)

    if (env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO users (discord_id, username, avatar_hash, og_tier, server_ids_json, last_seen_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(discord_id) DO UPDATE SET
            username = excluded.username,
            avatar_hash = excluded.avatar_hash,
            og_tier = excluded.og_tier,
            server_ids_json = excluded.server_ids_json,
            last_seen_at = datetime('now')
        `)
          .bind(
            user.id,
            user.username,
            user.avatar ?? null,
            tier,
            JSON.stringify(guildIds)
          )
          .run()
      } catch (dbErr) {
        console.warn(
          JSON.stringify({
            at: new Date().toISOString(),
            event: "security.auth.user_upsert_failed",
            detail: dbErr instanceof Error ? dbErr.message : String(dbErr),
          })
        )
      }
    }

    const jwt = await signJWT(
      {
        sub: user.id,
        username: user.username,
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
        tier,
        badges,
      },
      env.JWT_SECRET
    )

    const authCode = await mintOneTimeAuthCode(env, jwt)
    if (wantsJSON(request)) {
      return json({ auth_code: authCode, expires_in: AUTH_CODE_TTL_SECONDS })
    }

    const callbackOrigin = new URL(redirectUri).origin
    return redirect(`${callbackOrigin}/#auth_code=${encodeURIComponent(authCode)}`, {
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": buildClearPkceCookie(url),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth callback failed."
    const isCapacity = message === "CAPACITY_REACHED" || message.includes("KV put() limit exceeded")
    
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "security.auth.callback_failed",
        detail: message.slice(0, 300),
      })
    )

    const fallbackOrigin = (() => {
      try {
        return new URL(redirectUri).origin
      } catch {
        return url.origin
      }
    })()

    if (wantsJSON(request)) {
      return json({ error: isCapacity ? "CAPACITY_REACHED" : message }, 500)
    }

    const errorCode = isCapacity ? "CAPACITY_REACHED" : encodeURIComponent(message)
    return redirect(`${fallbackOrigin}/#auth_error=${errorCode}`, {
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": buildClearPkceCookie(url),
    })
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/exchange
// Exchange one-time code for secure HttpOnly cookie
// ---------------------------------------------------------------------------
async function handleAuthExchange(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SECRET) {
    return json({ ok: false, error: "auth_not_configured" }, 503)
  }

  const requestUrl = new URL(request.url)
  if (!isTrustedWriteRequest(request, requestUrl, env.ALLOWED_ORIGINS)) {
    return json({ ok: false, error: "untrusted_origin" }, 403)
  }

  const rate = await enforceRateLimit(env.CHRONICLES_KV, request, {
    keyPrefix: "auth_exchange",
    limit: 100,
    windowSeconds: 60,
    alertThreshold: 80,
  })
  if (!rate.ok) {
    return json({ ok: false, error: "rate_limited", retry_after: rate.retryAfterSeconds }, 429)
  }

  let code: string | null = null
  try {
    const body = (await request.json()) as { code?: unknown }
    if (typeof body?.code === "string") {
      code = body.code.trim()
    }
  } catch {
    // no-op, fallback to query/hash-like input below
  }

  if (!code) {
    const url = new URL(request.url)
    code = url.searchParams.get("code")
    if (!code) {
      code = readFragmentParam(url.hash, "code")
    }
  }

  if (!code || code.length < 10 || code.length > 128) {
    return json({ ok: false, error: "invalid_auth_code" }, 400)
  }

  const key = `authcode:${code}`
  const raw = await env.CHRONICLES_KV.get(key)
  if (!raw) {
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "security.auth.exchange_code_missing",
      })
    )
    return json({ ok: false, error: "invalid_or_expired_auth_code" }, 400)
  }

  try {
    await env.CHRONICLES_KV.delete(key)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("KV put() limit exceeded")) {
      return json({ ok: false, error: "CAPACITY_REACHED" }, 500)
    }
    // Non-blocking for other errors or log them
  }

  let token: string
  try {
    const parsed = JSON.parse(raw) as { jwt?: string }
    token = typeof parsed.jwt === "string" ? parsed.jwt : ""
  } catch {
    return json({ ok: false, error: "invalid_auth_code_payload" }, 400)
  }

  if (!token) {
    return json({ ok: false, error: "invalid_auth_code_payload" }, 400)
  }

  return json(
    {
      ok: true,
      issued: true,
    },
    200,
    {
      "Set-Cookie": buildAuthCookie(token, requestUrl, AUTH_COOKIE_TTL_SECONDS),
      "Cache-Control": "no-store",
    }
  )
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/me
// Validates JWT and returns current user profile
// ---------------------------------------------------------------------------
async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireSessionUser(request, env)
  if (!auth.ok) {
    // Quietly return 200 for missing tokens to avoid console noise for guests
    const status = auth.error === "missing_auth_token" ? 200 : auth.status
    return json({ ok: false, error: auth.error }, status)
  }

  return json({
    ok: true,
    user: {
      discordId: auth.payload.sub,
      username: auth.payload.username,
      avatar: auth.payload.avatar,
      tier: auth.payload.tier,
      badges: auth.payload.badges || [],
    },
  })
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/disconnect
// Clear secure auth cookie
// ---------------------------------------------------------------------------
async function handleDisconnect(request: Request, env: Env): Promise<Response> {
  void env
  if (!isTrustedWriteRequest(request, new URL(request.url), env.ALLOWED_ORIGINS)) {
    return json({ ok: false, error: "untrusted_origin" }, 403)
  }
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": buildClearAuthCookie(new URL(request.url)),
      "Cache-Control": "no-store",
    }
  )
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------
export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = normalizeAuthPath(url.pathname)

  if (request.method === "GET" && path === "/api/auth/discord") {
    return handleDiscordInit(request, env)
  }

  if (request.method === "GET" && path === "/api/auth/callback") {
    return handleDiscordCallback(request, env)
  }

  if (request.method === "POST" && path === "/api/auth/exchange") {
    return handleAuthExchange(request, env)
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    return handleAuthMe(request, env)
  }

  if (request.method === "POST" && path === "/api/auth/disconnect") {
    return handleDisconnect(request, env)
  }

  return json({ error: "Auth route not found." }, 404)
}
