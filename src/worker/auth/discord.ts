// Discord OAuth2 API helpers.
// All requests go server-side (Worker) — no tokens ever reach the browser.

export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  bot?: boolean
  mfa_enabled?: boolean
  locale?: string
  verified?: boolean
  email?: string | null
  flags?: number
  premium_type?: number
  public_flags?: number
  accent_color?: number | null
  global_name?: string | null
}

export interface DiscordGuild {
  id: string
  name: string
  icon: string | null
  owner: boolean
  permissions: string
}

export interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

export interface DiscordError {
  code?: number
  message?: string
  error?: string
  error_description?: string
}

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_OAUTH = "https://discord.com/api/oauth2/token"

/**
 * Exchange OAuth authorization code for access token using PKCE.
 */
export async function exchangeCode(params: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })

  const res = await fetch(DISCORD_OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") ?? "1"
    throw new Error(`Discord rate limited. Retry after ${retryAfter}s.`)
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as DiscordError
    throw new Error(
      `Discord token exchange failed (${res.status}): ${err.error_description ?? err.message ?? "unknown"}`
    )
  }

  return res.json() as Promise<DiscordTokenResponse>
}

/**
 * Fetch the authenticated Discord user profile.
 */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 401) throw new Error("Discord access token invalid or expired.")
  if (res.status === 429) throw new Error("Discord rate limited on /users/@me.")
  if (!res.ok) throw new Error(`Discord /users/@me failed (${res.status}).`)

  return res.json() as Promise<DiscordUser>
}

/**
 * Fetch the list of guilds the authenticated user belongs to.
 * Returns empty array on rate limit to degrade gracefully (tier fallback to community).
 */
export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 429) {
    console.warn("Discord rate limited on /users/@me/guilds — tier will fall back.")
    return []
  }
  if (res.status === 401) throw new Error("Discord access token invalid on /guilds.")
  if (!res.ok) {
    console.warn(`Discord /users/@me/guilds failed (${res.status}) — tier will fall back.`)
    return []
  }

  return res.json() as Promise<DiscordGuild[]>
}

/**
 * Generate PKCE code_verifier (random 64 bytes, base64url).
 */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Derive PKCE code_challenge from verifier (SHA-256, base64url).
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(verifier))
  const bytes = new Uint8Array(hash)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Build Discord OAuth2 authorization URL.
 */
export function buildAuthorizationUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const url = new URL("https://discord.com/oauth2/authorize")
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("scope", "identify guilds")
  url.searchParams.set("state", params.state)
  url.searchParams.set("code_challenge", params.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

/**
 * Parse Discord account creation date from snowflake ID.
 * Discord epoch: 2015-01-01T00:00:00.000Z = 1420070400000ms
 */
export function discordSnowflakeToDate(id: string): Date {
  const timestamp = Number(BigInt(id) >> 22n) + 1420070400000
  return new Date(timestamp)
}
