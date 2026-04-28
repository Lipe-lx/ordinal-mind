import type { Env } from "../index"
import { handleWikiTool } from "../wiki/tools"

export async function handleWikiRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === "GET" && url.pathname.startsWith("/api/wiki/") && !url.pathname.startsWith("/api/wiki/tools/")) {
    const slug = decodeURIComponent(url.pathname.replace("/api/wiki/", ""))
    return json(
      {
        ok: false,
        error: "wiki_page_not_found",
        slug,
        phase: "contract_first_placeholder",
      },
      404
    )
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/wiki/tools/")) {
    const toolName = url.pathname.replace("/api/wiki/tools/", "")
    return handleWikiTool(toolName, request, env)
  }

  return json({ ok: false, error: "wiki_route_not_found" }, 404)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
