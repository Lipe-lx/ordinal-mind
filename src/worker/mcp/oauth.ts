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
import { getCookie } from "../auth/session"
import { calculateTier } from "../auth/tierEngine"
import { normalizeTier, type McpResolvedAuth, type McpAuthProps } from "./types"
import { McpOAuthStateDO, type McpOAuthPendingState } from "./oauthStateDO"

interface PendingMcpAuthorization {
  created_at: string
  discord_state: string
  code_verifier: string
  oauth_request: AuthRequest
  redirect_origin_fingerprint?: string
  version?: number
}

const OAUTH_STATE_TTL_SECONDS = 15 * 60
const MCP_ACCESS_TOKEN_TTL_SECONDS = 30 * 60
const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const CALLBACK_STATE_READ_ATTEMPTS = 3
const CALLBACK_STATE_READ_RETRY_MS = 120
const MCP_OAUTH_STATE_COOKIE_NAME = "ordinal_mind_mcp_oauth_state"

interface PendingMcpAuthorizationCookie {
  v: 1
  pending: PendingMcpAuthorization
}

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

type McpRouteOAuthApi = Pick<OAuthHelpers, "parseAuthRequest" | "completeAuthorization">

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

function redirect(url: string, status = 302, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { Location: url, ...(extraHeaders ?? {}) },
  })
}

function requireOAuthKv(env: Env): KVNamespace | null {
  return env.OAUTH_KV ?? null
}

function requireOAuthStateDo(env: Env): DurableObjectNamespace | null {
  return env.MCP_OAUTH_STATE_DO ?? null
}

function buildCallbackUrl(request: Request): string {
  const reqUrl = new URL(request.url)
  return `${reqUrl.origin}${MCP_OAUTH_PATHS.callback}`
}

function buildOAuthErrorRedirect(
  message: string,
  options?: { clearStateCookie?: string }
): Response {
  const body = `<html><body><h1>MCP OAuth failed</h1><p>${escapeHtml(message)}</p></body></html>`
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
  }
  if (options?.clearStateCookie) {
    headers["Set-Cookie"] = options.clearStateCookie
  }
  return new Response(body, {
    status: 400,
    headers,
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

function base64Encode(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: { from: (v: Uint8Array) => { toString: (enc: string) => string } } })
    .Buffer
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64")
  }
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64Decode(value: string): Uint8Array {
  const BufferCtor = (globalThis as {
    Buffer?: { from: (v: string, enc: string) => { values: () => IterableIterator<number> } }
  }).Buffer
  if (BufferCtor) {
    return Uint8Array.from(BufferCtor.from(value, "base64").values())
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return base64Decode(padded)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  const out: string[] = []
  for (const b of new Uint8Array(hash)) {
    out.push(b.toString(16).padStart(2, "0"))
  }
  return out.join("")
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i += 1) {
    const ac = i < a.length ? a.charCodeAt(i) : 0
    const bc = i < b.length ? b.charCodeAt(i) : 0
    diff |= ac ^ bc
  }
  return diff === 0
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return base64UrlEncode(new Uint8Array(signature))
}

async function buildPendingStateCookie(
  request: Request,
  env: Env,
  pending: PendingMcpAuthorization
): Promise<string | null> {
  const secret = env.DISCORD_CLIENT_SECRET?.trim()
  if (!secret) return null

  const payload: PendingMcpAuthorizationCookie = {
    v: 1,
    pending,
  }
  const payloadJson = JSON.stringify(payload)
  const payloadEncoded = base64UrlEncode(new TextEncoder().encode(payloadJson))
  const signature = await signPayload(payloadEncoded, secret)
  const cookieValue = encodeURIComponent(`${payloadEncoded}.${signature}`)
  const reqUrl = new URL(request.url)
  const secure = reqUrl.protocol === "https:" ? "; Secure" : ""
  return `${MCP_OAUTH_STATE_COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${OAUTH_STATE_TTL_SECONDS}; HttpOnly; SameSite=None${secure}`
}

function buildClearPendingStateCookie(request: Request): string {
  const reqUrl = new URL(request.url)
  const secure = reqUrl.protocol === "https:" ? "; Secure" : ""
  return `${MCP_OAUTH_STATE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=None${secure}`
}

function isPendingStateFresh(pending: PendingMcpAuthorization): boolean {
  const createdAt = Date.parse(pending.created_at)
  if (!Number.isFinite(createdAt)) return false
  return Date.now() - createdAt <= OAUTH_STATE_TTL_SECONDS * 1000
}

async function readPendingStateFromCookie(
  request: Request,
  env: Env,
  state: string
): Promise<PendingMcpAuthorization | null> {
  const secret = env.DISCORD_CLIENT_SECRET?.trim()
  if (!secret) return null

  const raw = getCookie(request, MCP_OAUTH_STATE_COOKIE_NAME)
  if (!raw) return null

  const [payloadEncoded, signature] = raw.split(".")
  if (!payloadEncoded || !signature) return null

  const expectedSignature = await signPayload(payloadEncoded, secret)
  if (!constantTimeEqual(signature, expectedSignature)) return null

  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadEncoded))
    const parsed = JSON.parse(payloadJson) as PendingMcpAuthorizationCookie
    if (parsed.v !== 1) return null
    if (!parsed.pending || parsed.pending.discord_state !== state) return null
    if (!isPendingStateFresh(parsed.pending)) return null
    return parsed.pending
  } catch {
    return null
  }
}

function buildStateKey(state: string): Promise<string> {
  return sha256Hex(state).then((hash) => `mcp_oauth_state:${hash}`)
}

async function doFetch(
  ns: DurableObjectNamespace,
  path: string,
  body: unknown
): Promise<Response> {
  const id = ns.idFromName("mcp-oauth-state")
  const stub = ns.get(id)
  return stub.fetch(`https://state.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function issueStateInDo(
  ns: DurableObjectNamespace,
  state: string,
  payload: McpOAuthPendingState
): Promise<boolean> {
  const expiresAt = Date.now() + McpOAuthStateDO.ttlMs()
  const res = await doFetch(ns, "/issue", {
    state,
    payload,
    expires_at: expiresAt,
  })
  return res.ok
}

async function consumeStateFromDo(
  ns: DurableObjectNamespace,
  state: string
): Promise<{ ok: true; payload: McpOAuthPendingState } | { ok: false; cause: string }> {
  const res = await doFetch(ns, "/consume", { state })
  const text = await res.text()
  const parsed = parseJson<{ ok?: boolean; payload?: McpOAuthPendingState; cause?: string }>(text)
  if (res.ok && parsed?.ok && parsed.payload) {
    return { ok: true, payload: parsed.payload }
  }
  return { ok: false, cause: parsed?.cause ?? "missing" }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readPendingStateWithRetry(
  kv: KVNamespace,
  key: string,
  attempts = CALLBACK_STATE_READ_ATTEMPTS,
  retryMs = CALLBACK_STATE_READ_RETRY_MS
): Promise<{ pending: PendingMcpAuthorization | null; attemptCount: number; lookupLatencyMs: number }> {
  const totalAttempts = Math.max(1, attempts)
  const startedAt = Date.now()
  for (let i = 0; i < totalAttempts; i += 1) {
    const pending = await readPendingState(kv, key)
    if (pending) {
      return {
        pending,
        attemptCount: i + 1,
        lookupLatencyMs: Date.now() - startedAt,
      }
    }
    if (i < totalAttempts - 1) {
      await sleep(retryMs)
    }
  }
  return {
    pending: null,
    attemptCount: totalAttempts,
    lookupLatencyMs: Date.now() - startedAt,
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

export async function getMcpOAuthApi(options: OAuthProviderOptions<Env>, env: Env): Promise<OAuthHelpers> {
  const { getOAuthApi } = await loadOAuthProviderLib()
  return getOAuthApi(options, env)
}

export async function handleMcpAuthorizeRoute(
  request: Request,
  env: Env,
  oauthApi: McpRouteOAuthApi | null
): Promise<Response> {
  if (!oauthApi) {
    return json({ ok: false, error: "oauth_provider_unavailable" }, 503)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ ok: false, error: "discord_oauth_not_configured" }, 503)
  }

  const stateDo = requireOAuthStateDo(env)
  if (!stateDo) {
    return json({ ok: false, error: "oauth_state_store_unavailable" }, 503)
  }

  const kv = requireOAuthKv(env)
  if (!kv) {
    return json({ ok: false, error: "oauth_kv_not_configured" }, 503)
  }

  let oauthReq: AuthRequest
  try {
    oauthReq = await oauthApi.parseAuthRequest(request)
  } catch (error) {
    return json({
      ok: false,
      error: "invalid_oauth_request",
      detail: error instanceof Error ? error.message : String(error),
    }, 400)
  }

  const state = crypto.randomUUID().replaceAll("-", "")
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)
  const callbackUrl = buildCallbackUrl(request)
  const callbackOrigin = new URL(callbackUrl).origin
  const redirectOriginFingerprint = await sha256Hex(callbackOrigin)

  const pendingState: PendingMcpAuthorization = {
    created_at: new Date().toISOString(),
    discord_state: state,
    code_verifier: codeVerifier,
    oauth_request: oauthReq,
    redirect_origin_fingerprint: redirectOriginFingerprint,
    version: 2,
  }

  const doPayload: McpOAuthPendingState = {
    created_at: pendingState.created_at,
    code_verifier: pendingState.code_verifier,
    oauth_request: pendingState.oauth_request,
    redirect_origin_fingerprint: redirectOriginFingerprint,
    version: 2,
  }
  const issueOk = await issueStateInDo(stateDo, state, doPayload)
  if (!issueOk) {
    return json({ ok: false, error: "oauth_provider_unavailable" }, 503)
  }

  const stateKey = await buildStateKey(state)
  await savePendingState(kv, stateKey, pendingState)
  const authorizationUrl = buildAuthorizationUrl({
    clientId: env.DISCORD_CLIENT_ID,
    redirectUri: callbackUrl,
    state,
    codeChallenge,
  })

  const stateHash = (await sha256Hex(state)).slice(0, 12)
  console.info(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp.oauth.state.issue",
    result: "ok",
    state_hash: stateHash,
  }))

  const pendingStateCookie = await buildPendingStateCookie(request, env, pendingState)
  return redirect(
    authorizationUrl,
    302,
    pendingStateCookie
      ? { "Set-Cookie": pendingStateCookie }
      : undefined
  )
}

export async function handleMcpCallbackRoute(
  request: Request,
  env: Env,
  oauthApi: McpRouteOAuthApi | null
): Promise<Response> {
  if (!oauthApi) {
    return json({ ok: false, error: "oauth_provider_unavailable" }, 503)
  }

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return json({ ok: false, error: "discord_oauth_not_configured" }, 503)
  }

  const stateDo = requireOAuthStateDo(env)
  if (!stateDo) {
    return json({ ok: false, error: "oauth_state_store_unavailable" }, 503)
  }

  const kv = requireOAuthKv(env)
  if (!kv) {
    return json({ ok: false, error: "oauth_kv_not_configured" }, 503)
  }

  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const discordError = url.searchParams.get("error")
  const clearStateCookie = buildClearPendingStateCookie(request)

  if (discordError) {
    return buildOAuthErrorRedirect(`Discord OAuth error: ${discordError}`, { clearStateCookie })
  }

  if (!code || !state) {
    return buildOAuthErrorRedirect("Missing code or state in callback", { clearStateCookie })
  }

  const stateHash = (await sha256Hex(state)).slice(0, 12)
  const consumed = await consumeStateFromDo(stateDo, state)
  const pendingFromDo = consumed.ok
    ? ({
      created_at: consumed.payload.created_at,
      discord_state: state,
      code_verifier: consumed.payload.code_verifier,
      oauth_request: consumed.payload.oauth_request,
      redirect_origin_fingerprint: consumed.payload.redirect_origin_fingerprint,
      version: consumed.payload.version,
    } satisfies PendingMcpAuthorization)
    : null
  const stateKey = await buildStateKey(state)
  const stateLookup = pendingFromDo
    ? { pending: null, attemptCount: 0, lookupLatencyMs: 0 }
    : await readPendingStateWithRetry(kv, stateKey)
  const pendingFromCookie = !pendingFromDo && !stateLookup.pending
    ? await readPendingStateFromCookie(request, env, state)
    : null
  const pendingSource = pendingFromDo
    ? "durable_object"
    : stateLookup.pending
    ? "kv"
    : pendingFromCookie
      ? "cookie_fallback"
      : "none"
  const cfRay = request.headers.get("cf-ray")
  const requestId = cfRay ?? crypto.randomUUID()
  const coloGuess = cfRay?.split("-")[1] ?? null
  console.info(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp.oauth.state.lookup",
    request_id: requestId,
    cf_ray: cfRay,
    colo: coloGuess,
    state_found: Boolean(pendingFromDo || stateLookup.pending || pendingFromCookie),
    state_source: pendingSource,
    state_hash: stateHash,
    attempt_count: stateLookup.attemptCount,
    lookup_latency_ms: stateLookup.lookupLatencyMs,
    error_class: pendingFromDo || stateLookup.pending || pendingFromCookie ? null : "state_not_found",
  }))

  console.info(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp.oauth.state.consume",
    result: consumed.ok ? "ok" : "miss",
    cause_class: consumed.ok ? null : consumed.cause,
    state_hash: stateHash,
    request_id: requestId,
    cf_ray: cfRay,
    colo: coloGuess,
  }))

  if (!pendingFromDo && !stateLookup.pending && !pendingFromCookie) {
    console.warn(JSON.stringify({
      at: new Date().toISOString(),
      event: "mcp.oauth.state.miss",
      request_id: requestId,
      cf_ray: cfRay,
      colo: coloGuess,
      attempt_count: stateLookup.attemptCount,
      lookup_latency_ms: stateLookup.lookupLatencyMs,
      cause_hint: "eventual_consistency_or_expired_or_reused_state",
    }))
    return buildOAuthErrorRedirect("Authorization state expired. Please restart the OAuth flow.", {
      clearStateCookie,
    })
  }
  const pending = pendingFromDo ?? stateLookup.pending ?? pendingFromCookie

  if (!pending) {
    return buildOAuthErrorRedirect("Authorization state expired. Please restart the OAuth flow.", {
      clearStateCookie,
    })
  }

  try {
    // Consume the state once resolved to prevent replay.
    await deletePendingState(kv, stateKey)

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

    const { redirectTo } = await oauthApi.completeAuthorization({
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

    return redirect(redirectTo, 302, { "Set-Cookie": clearStateCookie })
  } catch (error) {
    return buildOAuthErrorRedirect(error instanceof Error ? error.message : String(error), {
      clearStateCookie,
    })
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

  const oauthApi = await getMcpOAuthApi(options, env)
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
