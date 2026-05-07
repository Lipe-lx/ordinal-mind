import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index"
import { registerResources } from "./resources"
import { registerTools } from "./tools"
import { type McpResolvedAuth } from "./types"

function buildAllowedOrigins(requestUrl: URL, extraAllowed?: string): Set<string> {
  const allowed = new Set<string>([requestUrl.origin])
  if (!extraAllowed) return allowed
  for (const token of extraAllowed.split(",")) {
    const trimmed = token.trim()
    if (trimmed) allowed.add(trimmed)
  }
  return allowed
}

export function isTrustedMcpOrigin(request: Request, extraAllowedOrigins?: string): boolean {
  const url = new URL(request.url)
  const origin = request.headers.get("Origin")
  if (!origin) return true

  const allowed = buildAllowedOrigins(url, extraAllowedOrigins)
  return allowed.has(origin)
}

export function isMcpEnabled(env: Env): boolean {
  return env.MCP_ENABLED === "1"
}

function logMcpEvent(payload: Record<string, unknown>): void {
  console.info(JSON.stringify({
    at: new Date().toISOString(),
    event: "mcp.request",
    ...payload,
  }))
}

export function createOrdinalMindMcpServer(options: {
  env: Env
  auth?: McpResolvedAuth
  request: Request
}): McpServer {
  const server = new McpServer({ name: "ordinal-mind", version: "2.0.0" })
  registerResources(server, options.env)
  registerTools({
    server,
    env: options.env,
    auth: options.auth,
    request: options.request,
  })
  return server
}

export async function handleMcpRequest(options: {
  request: Request
  env: Env
  ctx: ExecutionContext
  auth?: McpResolvedAuth
}): Promise<Response> {
  const { request, env, ctx, auth } = options
  const startedAt = Date.now()

  if (!isTrustedMcpOrigin(request, env.ALLOWED_ORIGINS)) {
    return new Response(JSON.stringify({ ok: false, error: "untrusted_origin" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
      },
    })
  }

  const server = createOrdinalMindMcpServer({ env, auth, request })
  const { createMcpHandler } = await import("agents/mcp")
  const handler = createMcpHandler(server, {
    route: "/mcp",
    authContext: auth ? { props: auth.props as unknown as Record<string, unknown> } : undefined,
    corsOptions: {
      origin: "*",
      methods: "GET,POST,DELETE,OPTIONS",
      headers: "Content-Type,Authorization,Mcp-Session-Id",
      exposeHeaders: "Mcp-Session-Id",
    },
  })

  try {
    const response = await handler(request, env, ctx)
    logMcpEvent({
      request_id: crypto.randomUUID().slice(0, 8),
      path: new URL(request.url).pathname,
      method: request.method,
      subject: auth?.props.sub ?? null,
      tier: auth?.props.tier ?? "anon",
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })
    return response
  } catch (error) {
    logMcpEvent({
      request_id: crypto.randomUUID().slice(0, 8),
      path: new URL(request.url).pathname,
      method: request.method,
      subject: auth?.props.sub ?? null,
      tier: auth?.props.tier ?? "anon",
      status: 500,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })

    return new Response(JSON.stringify({ ok: false, error: "mcp_handler_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
