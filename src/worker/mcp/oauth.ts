import type {
  AuthRequest,
  OAuthHelpers,
  OAuthProvider,
  OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider"
import type { Env } from "../index"
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
import { normalizeTier, type McpResolvedAuth, type McpAuthProps } from "./types"

interface PendingMcpAuthorization {
  created_at: string
  discord_state: string
  code_verifier: string
  oauth_request: AuthRequest
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60
const MCP_ACCESS_TOKEN_TTL_SECONDS = 30 * 60
const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export const MCP_OAUTH_PATHS = {
  authorize: "/mcp/oauth/authorize",
  callback: "/mcp/oauth/callback",
  token: "/mcp/oauth/token",
  register: "/mcp/oauth/register",
} as const

const SUPPORTED_SCOPES = [
  "wiki.contribute",
  "wiki.review",
  "chronicle.refresh",
  "collection.reindex",
] as const

export type McpOAuthRuntime = {
  provider: OAuthProvider<Env>
  options: OAuthProviderOptions<Env>
}

type McpRouteOAuthProvider = Pick<OAuthProvider<Env>, "parseAuthRequest" | "completeAuthorization">

type ExportedFetchHandler<EnvT> = {
  fetch: (request: Request, env: EnvT, ctx: ExecutionContext) => Response | Promise<Response>
}

async function loadOAuthProviderLib(): Promise<{
  OAuthProvider: new (options: OAuthProviderOptions<Env>) => OAuthProvider<Env>
  getOAuthApi: (options: OAuthProviderOptions<Env>, env: Env) => OAuthHelpers
}> {
  const mod = await import("@cloudflare/workers-oauth-provider")
  return {
    OAuthProvider: mod.OAuthProvider as new (options: OAuthProviderOptions<Env>) => OAuthProvider<Env>,
    getOAuthApi: mod.getOAuthApi as (options: OAuthProviderOptions<Env>, env: Env) => OAuthHelpers,
  }
}

function pickGrantedScopes(requested: string[], tier: McpAuthProps["tier"]): string[] {
  const allowed = new Set<string>()

  if (tier === "community" || tier === "og" || tier === "genesis") {
    allowed.add("wiki.contribute")
  }
  if (tier === "genesis") {
    allowed.add("wiki.review")
    allowed.add("chronicle.refresh")
    allowed.add("collection.reindex")
  }

  const requestedSet = new Set(requested)
  return SUPPORTED_SCOPES.filter((scope) => requestedSet.has(scope) && allowed.has(scope))
}

function scopesToCapabilities(scopes: string[]): string[] {
  const caps: string[] = []
  if (scopes.includes("wiki.contribute")) caps.push("contribute_wiki")
  if (scopes.includes("wiki.review")) caps.push("review_contribution")
  if (scopes.includes("chronicle.refresh")) caps.push("refresh_chronicle")
  if (scopes.includes("collection.reindex")) caps.push("reindex_collection")
  return caps
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

function redirect(url: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: url },
  })
}

function requireOAuthKv(env: Env): KVNamespace | null {
  return env.OAUTH_KV ?? null
}

function buildCallbackUrl(request: Request): string {
  const reqUrl = new URL(request.url)
  return `${reqUrl.origin}${MCP_OAUTH_PATHS.callback}`
}

function buildOAuthErrorRedirect(message: string): Response {
  const body = `<html><body><h1>MCP OAuth failed</h1><p>${escapeHtml(message)}</p></body></html>`
  return new Response(body, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

async function savePendingState(
  kv: KVNamespace,
  key: string,
  payload: PendingMcpAuthorization
): Promise<void> {
  await kv.put(key, JSON.stringify(payload), { expirationTtl: OAUTH_STATE_TTL_SECONDS })
}

async function readPendingState(kv: KVNamespace, key: string): Promise<PendingMcpAuthorization | null> {
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingMcpAuthorization
  } catch {
    return null
  }
}

async function deletePendingState(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key)
}

export function buildMcpOAuthOptions(defaultHandler: ExportedFetchHandler<Env>): OAuthProviderOptions<Env> {
  return {
    apiRoute: "/mcp",
    apiHandler: defaultHandler,
    defaultHandler,
    authorizeEndpoint: MCP_OAUTH_PATHS.authorize,
    tokenEndpoint: MCP_OAUTH_PATHS.token,
    clientRegistrationEndpoint: MCP_OAUTH_PATHS.register,
    accessTokenTTL: MCP_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: MCP_REFRESH_TOKEN_TTL_SECONDS,
    scopesSupported: [...SUPPORTED_SCOPES],
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    allowTokenExchangeGrant: false,
    disallowPublicClientRegistration: false,
    onError: ({ code, description, status, headers }) => {
      console.warn(JSON.stringify({
        at: new Date().toISOString(),
        event: "mcp.oauth.error",
        code,
        description,
        status,
      }))
      return new Response(JSON.stringify({ ok: false, error: code, detail: description }), {
        status,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      })
    },
  }
}

export async function createMcpOAuthProvider(defaultHandler: ExportedFetchHandler<Env>): Promise<McpOAuthRuntime> {
  const { OAuthProvider } = await loadOAuthProviderLib()
  const options = buildMcpOAuthOptions(defaultHandler)
  return {
    provider: new OAuthProvider(options),
    options,
  }
}

export async function handleMcpAuthorizeRoute(
  request: Request,
  env: Env,
  provider: McpRouteOAuthProvider | null
): Promise<Response> {
  if (!provider) {
    return json({ ok: false, error: "oauth_provider_unavailable" }, 503)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ ok: false, error: "discord_oauth_not_configured" }, 503)
  }

  const kv = requireOAuthKv(env)
  if (!kv) {
    return json({ ok: false, error: "oauth_kv_not_configured" }, 503)
  }

  let oauthReq: AuthRequest
  try {
    oauthReq = await provider.parseAuthRequest(request)
  } catch (error) {
    return json({
      ok: false,
      error: "invalid_oauth_request",
      detail: error instanceof Error ? error.message : String(error),
    }, 400)
  }

  const discordState = crypto.randomUUID().replaceAll("-", "")
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)

  const stateKey = `mcp_oauth_state:${discordState}`
  await savePendingState(kv, stateKey, {
    created_at: new Date().toISOString(),
    discord_state: discordState,
    code_verifier: codeVerifier,
    oauth_request: oauthReq,
  })

  const callbackUrl = buildCallbackUrl(request)
  const authorizationUrl = buildAuthorizationUrl({
    clientId: env.DISCORD_CLIENT_ID,
    redirectUri: callbackUrl,
    state: discordState,
    codeChallenge,
  })

  return redirect(authorizationUrl)
}

export async function handleMcpCallbackRoute(
  request: Request,
  env: Env,
  provider: McpRouteOAuthProvider | null
): Promise<Response> {
  if (!provider) {
    return json({ ok: false, error: "oauth_provider_unavailable" }, 503)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ ok: false, error: "discord_oauth_not_configured" }, 503)
  }

  const kv = requireOAuthKv(env)
  if (!kv) {
    return json({ ok: false, error: "oauth_kv_not_configured" }, 503)
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const discordError = url.searchParams.get("error")

  if (discordError) {
    return buildOAuthErrorRedirect(`Discord OAuth error: ${discordError}`)
  }

  if (!code || !state) {
    return buildOAuthErrorRedirect("Missing code or state in callback")
  }

  const stateKey = `mcp_oauth_state:${state}`
  const pending = await readPendingState(kv, stateKey)
  await deletePendingState(kv, stateKey)

  if (!pending) {
    return buildOAuthErrorRedirect("Authorization state expired. Please restart the OAuth flow.")
  }

  try {
    const callbackUrl = buildCallbackUrl(request)
    const token = await exchangeCode({
      code,
      codeVerifier: pending.code_verifier,
      redirectUri: callbackUrl,
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
    })

    const [user, guilds] = await Promise.all([
      fetchDiscordUser(token.access_token),
      fetchDiscordGuilds(token.access_token),
    ])

    const tier = await calculateTier(
      user.id,
      guilds.map((g) => g.id),
      discordSnowflakeToDate(user.id),
      env.CHRONICLES_KV
    )

    const grantedScopes = pickGrantedScopes(pending.oauth_request.scope, tier)
    const props: McpAuthProps = {
      sub: user.id,
      username: user.global_name ?? user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
      tier,
      scopes: grantedScopes,
      capabilities: scopesToCapabilities(grantedScopes),
      auth_source: "discord_oauth",
    }

    const { redirectTo } = await provider.completeAuthorization({
      request: pending.oauth_request,
      userId: user.id,
      metadata: {
        tier,
        username: props.username,
        granted_at: new Date().toISOString(),
      },
      scope: grantedScopes,
      props,
      revokeExistingGrants: true,
    })

    return redirect(redirectTo)
  } catch (error) {
    return buildOAuthErrorRedirect(error instanceof Error ? error.message : String(error))
  }
}

export async function resolveMcpAuthFromRequest(
  request: Request,
  env: Env,
  options: OAuthProviderOptions<Env>
): Promise<McpResolvedAuth | undefined> {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) return undefined

  const token = authHeader.slice(7).trim()
  if (!token) return undefined

  const { getOAuthApi } = await loadOAuthProviderLib()
  const oauthApi = getOAuthApi(options, env)
  const unwrapped = await oauthApi.unwrapToken<McpAuthProps>(token)
  const tokenProps = unwrapped?.grant?.props
  if (!tokenProps) return undefined

  const tier = normalizeTier(tokenProps.tier)
  if (!tier || tier === "anon") return undefined

  return {
    props: {
      ...tokenProps,
      tier,
      scopes: Array.isArray(tokenProps.scopes) ? tokenProps.scopes : [],
      capabilities: Array.isArray(tokenProps.capabilities) ? tokenProps.capabilities : [],
      auth_source: "discord_oauth",
    },
  }
}
