// Auth routes: Discord OAuth2 + PKCE flow.
// Routes:
//   GET  /api/auth/discord     → initiate OAuth (generate PKCE + state, redirect)
//   GET  /api/auth/callback    → exchange code, compute tier, sign JWT, redirect SPA
//   GET  /api/auth/me          → verify JWT, return profile
//   POST /api/auth/disconnect  → optional analytics log

import type { Env } from "../index"
import { signJWT, verifyJWT } from "../auth/jwt"
import {
  buildAuthorizationUrl,
  deriveCodeChallenge,
  discordSnowflakeToDate,
  exchangeCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  generateCodeVerifier,
} from "../auth/discord"
import { calculateTier } from "../auth/tierEngine"

const PKCE_TTL_SECONDS = 5 * 60 // 5 minutes

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  })
}

function getRedirectUri(requestUrl: URL): string {
  return `${requestUrl.origin}/api/auth/callback`
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/discord
// Initiates OAuth flow: generate PKCE + state, store in KV, redirect to Discord
// ---------------------------------------------------------------------------
async function handleDiscordInit(request: Request, env: Env): Promise<Response> {
  if (!env.DISCORD_CLIENT_ID) {
    return json({ error: "Discord integration not configured." }, 503)
  }

  const url = new URL(request.url)
  const state = crypto.randomUUID()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)

  // Store PKCE verifier in KV, keyed by state, TTL 5min
  const pkceKey = `pkce:${state}`
  await env.CHRONICLES_KV.put(
    pkceKey,
    JSON.stringify({ code_verifier: codeVerifier, created_at: new Date().toISOString() }),
    { expirationTtl: PKCE_TTL_SECONDS }
  )

  const authUrl = buildAuthorizationUrl({
    clientId: env.DISCORD_CLIENT_ID,
    redirectUri: getRedirectUri(url),
    state,
    codeChallenge,
  })

  if (request.headers.get("Accept")?.includes("application/json")) {
    return json({ url: authUrl })
  }

  return redirect(authUrl)
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/callback
// Receives Discord OAuth code, exchanges for token, computes tier, issues JWT
// ---------------------------------------------------------------------------
async function handleDiscordCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const errorParam = url.searchParams.get("error")

  // Discord denied access
  if (errorParam) {
    if (request.headers.get("Accept")?.includes("application/json")) {
      return json({ error: errorParam }, 400)
    }
    return redirect(`${url.origin}/?auth_error=${encodeURIComponent(errorParam)}`)
  }

  if (!code || !state) {
    return json({ error: "Missing code or state parameter." }, 400)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.JWT_SECRET) {
    return json({ error: "Discord integration not configured." }, 503)
  }

  // Retrieve and consume PKCE verifier
  const pkceKey = `pkce:${state}`
  const pkceRaw = await env.CHRONICLES_KV.get(pkceKey)
  
  if (!pkceRaw) {
    console.error(`[Auth] PKCE state NOT FOUND in KV for key: ${pkceKey}`)
    return json({ error: "Invalid or expired OAuth state. Please try connecting again." }, 400)
  }
  
  console.log(`[Auth] PKCE state found for key: ${pkceKey}. Proceeding with exchange.`)


  // Delete PKCE entry immediately (one-time use)
  await env.CHRONICLES_KV.delete(pkceKey)

  let codeVerifier: string
  try {
    const pkce = JSON.parse(pkceRaw) as { code_verifier: string }
    codeVerifier = pkce.code_verifier
  } catch {
    return json({ error: "Corrupted PKCE state." }, 500)
  }

  try {
    console.log(`[Auth] Exchanging code for Discord tokens...`)
    const tokens = await exchangeCode({
      code,
      codeVerifier,
      redirectUri: getRedirectUri(url),
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    })

    console.log(`[Auth] Fetching user profile and guilds...`)
    const [user, guilds] = await Promise.all([
      fetchDiscordUser(tokens.access_token),
      fetchDiscordGuilds(tokens.access_token),
    ])

    const accountCreatedAt = discordSnowflakeToDate(user.id)
    const guildIds = guilds.map((g) => g.id)
    console.log(`[Auth] Calculating tier for user: ${user.username} (${user.id})`)
    const tier = await calculateTier(user.id, guildIds, accountCreatedAt, env.CHRONICLES_KV)

    console.log(`[Auth] Tier calculated: ${tier}. Upserting user in DB...`)

    // Upsert user in D1
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
        console.log(`[Auth] User upserted in DB successfully.`)
      } catch (dbErr) {
        console.error(`[Auth] DB upsert failed:`, dbErr)
        // We continue anyway, DB is non-critical for auth
      }
    } else {
      console.warn(`[Auth] DB not bound, skipping upsert.`)
    }

    console.log(`[Auth] Signing JWT...`)
    // Sign JWT
    const jwt = await signJWT(
      {
        sub: user.id,
        username: user.username,
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
        tier,
      },
      env.JWT_SECRET || ""
    )
    console.log(`[Auth] JWT signed. Sending response.`)

    // Redirect back to SPA with JWT as query param
    // The useDiscordIdentity hook captures this, stores it, and cleans the URL
    if (request.headers.get("Accept")?.includes("application/json")) {
      return json({ token: jwt })
    }
    return redirect(`${url.origin}/?auth_token=${encodeURIComponent(jwt)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth callback failed."
    console.error("Discord callback error:", err)
    if (request.headers.get("Accept")?.includes("application/json")) {
      return json({ error: message }, 500)
    }
    return redirect(`${url.origin}/?auth_error=${encodeURIComponent(message)}`)
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/auth/me
// Validates JWT and returns current user profile
// ---------------------------------------------------------------------------
async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SECRET) {
    return json({ ok: false, error: "Auth not configured." }, 503)
  }

  // Accept token from Authorization header or query param
  const authHeader = request.headers.get("Authorization")
  const url = new URL(request.url)
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : url.searchParams.get("token")

  if (!token) {
    return json({ ok: false, error: "No token provided." }, 401)
  }

  const payload = await verifyJWT(token, env.JWT_SECRET)
  if (!payload) {
    return json({ ok: false, error: "Invalid or expired token." }, 401)
  }

  return json({
    ok: true,
    user: {
      discordId: payload.sub,
      username: payload.username,
      avatar: payload.avatar,
      tier: payload.tier,
    },
  })
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/disconnect
// Optional: log disconnect event for analytics
// ---------------------------------------------------------------------------
async function handleDisconnect(_request: Request, env: Env): Promise<Response> {
  // Non-critical: just acknowledge. Future: log to D1 for analytics.
  void env // used for future analytics
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------
export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === "GET" && path === "/api/auth/discord") {
    return handleDiscordInit(request, env)
  }

  if (request.method === "GET" && path === "/api/auth/callback") {
    return handleDiscordCallback(request, env)
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    return handleAuthMe(request, env)
  }

  if (request.method === "POST" && path === "/api/auth/disconnect") {
    return handleDisconnect(request, env)
  }

  return json({ error: "Auth route not found." }, 404)
}
