// Worker entrypoint — routing and orchestration.
// Routes:
//   OPTIONS *            → CORS preflight
//   GET /api/chronicle   → resolver → cache → pipeline → response
//   GET /api/chronicle?stream=1 → SSE streaming with progress feedback
//   /mcp                 → MCP Streamable HTTP handler (feature-flagged)
//   * (everything else)  → env.ASSETS.fetch(request) — SPA static assets

import { resolveInput } from "./resolver"
import { cacheGet } from "./cache"
import { handleWikiRoute } from "./routes/wiki"
import { handleAuthRoute } from "./routes/auth"
import { handleSitemapRoute } from "./routes/sitemap"
import { handleRobotsRoute } from "./routes/robots"
import { seoMiddleware } from "./routes/seo"
import { fetchUnisat } from "./agents/unisat"
import { attachSecurityHeaders, buildApiPreflightResponse } from "./security"
import { newRequestId, runChroniclePipeline } from "./chronicleService"
import type { DiagnosticsContext, ProgressCallback } from "./pipeline/types"
import { handleMcpRequest, isMcpEnabled } from "./mcp"
import {
  MCP_OAUTH_PATHS,
  type McpOAuthRuntime,
  createMcpOAuthProvider,
  getMcpOAuthApi,
  handleMcpAuthorizeRoute,
  handleMcpCallbackRoute,
  handleMcpFlowCancelRoute,
  handleMcpFlowAuthorizeRoute,
  handleMcpFlowCompleteRoute,
  handleMcpFlowStartRoute,
  handleMcpFlowStatusRoute,
  resolveMcpAuthFromRequest,
} from "./mcp/oauth"
import { McpOAuthStateDO } from "./mcp/oauthStateDO"
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider"

export interface Env {
  CHRONICLES_KV: KVNamespace
  OAUTH_KV?: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ENVIRONMENT: string
  UNISAT_API_KEY?: string
  ORD_NET_API_KEY?: string
  DB?: D1Database
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  DISCORD_REDIRECT_URI?: string
  JWT_SECRET?: string
  OAUTH_PROVIDER?: OAuthHelpers
  ALLOWED_ORIGINS?: string
  MCP_ENABLED?: string
  MCP_OAUTH_ENABLED?: string
  MCP_SPEC_TARGET?: string
  MCP_OAUTH_STATE_DO?: DurableObjectNamespace
  AI?: { run: (model: string, input: unknown) => Promise<unknown> }
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
}

let mcpOAuthRuntimePromise: Promise<McpOAuthRuntime> | null = null

function isMcpOauthEnabled(env: Env): boolean {
  return env.MCP_OAUTH_ENABLED === "1"
}

function isMcpOAuthProviderManagedPath(pathname: string): boolean {
  return pathname === MCP_OAUTH_PATHS.token
    || pathname === MCP_OAUTH_PATHS.register
    || pathname === "/.well-known/oauth-authorization-server"
    || pathname === "/.well-known/oauth-protected-resource"
}

async function getMcpOAuthRuntime(): Promise<McpOAuthRuntime> {
  if (mcpOAuthRuntimePromise) return mcpOAuthRuntimePromise

  const defaultHandler = {
    fetch: coreFetch,
  }

  mcpOAuthRuntimePromise = createMcpOAuthProvider(defaultHandler)
  return mcpOAuthRuntimePromise
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

function looksLikeOAuthAuthorizeAtRoot(url: URL): boolean {
  return url.pathname === "/"
    && url.searchParams.get("response_type") === "code"
    && Boolean(url.searchParams.get("client_id"))
    && Boolean(url.searchParams.get("redirect_uri"))
    && Boolean(url.searchParams.get("code_challenge"))
    && url.searchParams.get("code_challenge_method") === "S256"
}

function looksLikeOAuthCallbackAtRoot(url: URL): boolean {
  return url.pathname === "/"
    && Boolean(url.searchParams.get("code"))
    && Boolean(url.searchParams.get("state"))
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      const isDev = (env?.ENVIRONMENT === "development")
        || (url.hostname === "localhost")
        || (url.hostname === "127.0.0.1")

      const response = await coreFetch(request, env, ctx)

      return attachSecurityHeaders(request, response, isDev, env.ALLOWED_ORIGINS)
    } catch (err) {
      console.error("Worker fetch error:", err)
      return new Response(err instanceof Error ? err.message : "Internal Worker Error", { status: 500 })
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!(isMcpEnabled(env) && isMcpOauthEnabled(env))) return
    if (!env.OAUTH_KV) return

    try {
      const { provider } = await getMcpOAuthRuntime()
      const result = await provider.purgeExpiredData(env, { batchSize: 100 })
      ctx.waitUntil(
        Promise.resolve().then(() => {
          console.info(JSON.stringify({
            at: new Date().toISOString(),
            event: "mcp.oauth.purge",
            ...result,
          }))
        })
      )
    } catch (error) {
      console.error("MCP OAuth purge failed:", error)
    }
  },
}

export { McpOAuthStateDO }

async function coreFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === "OPTIONS") {
    return buildApiPreflightResponse(request, env.ALLOWED_ORIGINS)
  }

  if (isMcpEnabled(env)) {
    if (isMcpOauthEnabled(env) && looksLikeOAuthAuthorizeAtRoot(url)) {
      const fixed = new URL(request.url)
      fixed.pathname = MCP_OAUTH_PATHS.authorize
      return Response.redirect(fixed.toString(), 307)
    }

    if (isMcpOauthEnabled(env) && looksLikeOAuthCallbackAtRoot(url)) {
      const fixed = new URL(request.url)
      fixed.pathname = MCP_OAUTH_PATHS.callback
      return Response.redirect(fixed.toString(), 307)
    }

    if (isMcpOauthEnabled(env) && isMcpOAuthProviderManagedPath(url.pathname)) {
      const { provider } = await getMcpOAuthRuntime()
      return provider.fetch(request, env, ctx)
    }

    if (isMcpOauthEnabled(env) && request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.authorize) {
      try {
        const runtime = await getMcpOAuthRuntime()
        const oauthApi = await getMcpOAuthApi(runtime.options, env)
        return handleMcpAuthorizeRoute(request, env, oauthApi)
      } catch {
        return jsonResponse({ ok: false, error: "oauth_provider_unavailable" }, 503)
      }
    }

    if (isMcpOauthEnabled(env) && request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.callback) {
      try {
        const runtime = await getMcpOAuthRuntime()
        const oauthApi = await getMcpOAuthApi(runtime.options, env)
        return handleMcpCallbackRoute(request, env, oauthApi)
      } catch {
        return jsonResponse({ ok: false, error: "oauth_provider_unavailable" }, 503)
      }
    }

    if (isMcpOauthEnabled(env) && request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.flowStart) {
      try {
        const runtime = await getMcpOAuthRuntime()
        const oauthApi = await getMcpOAuthApi(runtime.options, env)
        return handleMcpFlowStartRoute(request, env, oauthApi)
      } catch {
        return jsonResponse({ ok: false, error: "oauth_provider_unavailable" }, 503)
      }
    }

    if (isMcpOauthEnabled(env) && request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.flowAuthorize) {
      return handleMcpFlowAuthorizeRoute(request, env)
    }

    if (isMcpOauthEnabled(env) && request.method === "GET" && url.pathname === MCP_OAUTH_PATHS.flowStatus) {
      return handleMcpFlowStatusRoute(request, env)
    }

    if (isMcpOauthEnabled(env) && request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.flowComplete) {
      return handleMcpFlowCompleteRoute(request, env)
    }

    if (isMcpOauthEnabled(env) && request.method === "POST" && url.pathname === MCP_OAUTH_PATHS.flowCancel) {
      return handleMcpFlowCancelRoute(request, env)
    }

    if (url.pathname.startsWith("/mcp")) {
      const auth = isMcpOauthEnabled(env)
        ? await resolveMcpAuthFromRequest(request, env, (await getMcpOAuthRuntime()).options)
        : undefined

      return handleMcpRequest({ request, env, ctx, auth })
    }
  }

  if (url.pathname === "/sitemap.xml" || url.pathname.endsWith(".txt")) {
    if (url.pathname === "/sitemap.xml") return handleSitemapRoute(env)
    if (url.pathname === "/robots.txt") return handleRobotsRoute()
    return env.ASSETS.fetch(request);
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, url, env)
  }

  return seoMiddleware(request, env, async () => env.ASSETS.fetch(request))
}

async function handleApi(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  if (url.pathname.startsWith("/api/auth")) {
    return handleAuthRoute(request, env)
  }

  if (url.pathname.startsWith("/api/wiki")) {
    return handleWikiRoute(request, env)
  }

  // GET /api/chronicle?id=<inscription_id_or_number_or_address>&stream=1
  if (url.pathname === "/api/chronicle") {
    const raw = url.searchParams.get("id")
    if (!raw) {
      return jsonResponse({ error: "id parameter is required" }, 400)
    }

    const useStream = url.searchParams.get("stream") === "1"
    const debug = url.searchParams.get("debug") === "1"
    const lite = url.searchParams.get("lite") === "1"

    try {
      const resolved = await resolveInput(raw)

      if (resolved.type === "address") {
        if (!env.UNISAT_API_KEY) {
          return jsonResponse(
            {
              error:
                "Address lookup requires a UniSat API key. Please configure UNISAT_API_KEY in the worker environment.",
            },
            501
          )
        }

        const cursor = Number.parseInt(url.searchParams.get("cursor") ?? "0", 10)
        const size = Number.parseInt(url.searchParams.get("size") ?? "48", 10)

        const page = await fetchUnisat.addressInscriptions(resolved.value, env.UNISAT_API_KEY, cursor, size)

        if (!page) {
          return jsonResponse({
            type: "address",
            address: resolved.value,
            inscriptions: [],
            total: 0,
            cursor: 0,
          })
        }

        return jsonResponse({
          type: "address",
          address: resolved.value,
          inscriptions: page.inscription.map((i) => ({
            id: i.inscriptionId,
            number: i.inscriptionNumber,
            content_type: i.contentType,
            content_url: `https://ordinals.com/content/${i.inscriptionId}`,
          })),
          total: page.total,
          cursor: page.cursor,
        })
      }

      const id = resolved.value
      const route: DiagnosticsContext["route"] = useStream ? "stream" : "standard"
      const diagnostics: DiagnosticsContext = {
        debug,
        requestId: newRequestId(),
        route,
        inscriptionId: id,
      }

      if (!useStream && !debug) {
        const cached = await cacheGet(env.CHRONICLES_KV, id)
        if (cached) {
          return jsonResponse({ ...cached, from_cache: true })
        }
      }

      if (useStream) {
        return handleStreamingChronicle(id, env, diagnostics)
      }

      return handleStandardChronicle(id, env, diagnostics, lite)
    } catch (err) {
      console.error("Chronicle API error:", err)
      const message = err instanceof Error ? err.message : "Internal error"
      const status = message.includes("not found") ? 404 : 500
      return jsonResponse({ error: message }, status)
    }
  }

  return jsonResponse({ error: "Not found" }, 404)
}

async function handleStandardChronicle(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext,
  lite?: boolean
): Promise<Response> {
  try {
    const result = await runChroniclePipeline({
      id,
      env,
      diagnostics,
      lite: Boolean(lite),
      persistToDb: true,
      writeCache: !lite,
      writeValidation: true,
    })

    return jsonResponse(result.chronicle)
  } catch (err) {
    console.error("Pipeline execution failed:", err)
    return jsonResponse({ error: "Inscription not found" }, 404)
  }
}

async function handleStreamingChronicle(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext
): Promise<Response> {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const sendEvent = async (type: string, data: unknown) => {
    try {
      await writer.write(
        encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch {
      // Writer may be closed if client disconnected.
    }
  }

  const onProgress: ProgressCallback = async (phase, step, description) => {
    await sendEvent("progress", { phase, step, description })
  }

  const pipeline = (async () => {
    try {
      const result = await runChroniclePipeline({
        id,
        env,
        diagnostics,
        lite: false,
        onProgress,
        persistToDb: true,
        writeCache: true,
        writeValidation: true,
      })

      await sendEvent("result", result.chronicle)
    } catch (err) {
      console.error("Streaming pipeline execution failed:", err)
      await sendEvent("error", {
        message: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      try {
        await writer.close()
      } catch {
        // Already closed.
      }
    }
  })()

  void pipeline

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}
