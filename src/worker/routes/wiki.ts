import type { Env } from "../index"
import { handleIngest } from "../wiki/ingest"
import { runWikiLint } from "../wiki/lint"
import {
  checkWikiSchema,
  getWikiSchemaFailure,
  isMissingWikiSchemaError,
  wikiHealthStatusCode,
} from "../wiki/schema"
import { handleWikiTool } from "../wiki/tools"
import { handleContribute } from "../wiki/contribute"
import { handleCompleteness } from "../wiki/completeness"
import { handleConsolidated } from "../wiki/consolidateEndpoint"

export async function handleWikiRoute(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "GET" && path === "/api/wiki/health") {
      const health = await checkWikiSchema(env)
      return json(health, wikiHealthStatusCode(health))
    }

    if (request.method === "GET" && path === "/api/wiki/lint") {
      const schemaFailure = await getWikiSchemaFailure(env)
      if (schemaFailure) return json(schemaFailure, 503)
      const report = await runWikiLint(env)
      return json(report)
    }

    if (request.method === "POST" && path === "/api/wiki/ingest") {
      return handleIngest(request, env)
    }

    if (request.method === "POST" && path === "/api/wiki/contribute") {
      return handleContribute(request, env)
    }

    if (request.method === "POST" && path.startsWith("/api/wiki/tools/")) {
      const toolName = path.replace("/api/wiki/tools/", "")
      return handleWikiTool(toolName, request, env)
    }

    if (request.method === "GET" && /^\/api\/wiki\/collection\/[^/]+\/completeness$/.test(path)) {
      const slug = decodeURIComponent(path.replace("/api/wiki/collection/", "").replace("/completeness", ""))
      return handleCompleteness(slug, env)
    }

    if (request.method === "GET" && /^\/api\/wiki\/collection\/[^/]+\/consolidated$/.test(path)) {
      const slug = decodeURIComponent(path.replace("/api/wiki/collection/", "").replace("/consolidated", ""))
      return handleConsolidated(slug, env)
    }

    if (request.method === "GET" && path.startsWith("/api/wiki/") && !path.startsWith("/api/wiki/tools/")) {
      const schemaFailure = await getWikiSchemaFailure(env)
      if (schemaFailure) return json(schemaFailure, 503)
      if (!env.DB) return json({ ok: false, error: "wiki_db_unavailable", phase: "fail_soft" }, 503)

      const slug = decodeURIComponent(path.replace("/api/wiki/", ""))
      const row = await env.DB.prepare(`
      SELECT slug, entity_type, title, summary, sections_json,
             cross_refs_json, source_event_ids_json, generated_at,
             byok_provider, unverified_count, view_count, updated_at
      FROM wiki_pages
      WHERE slug = ?
      LIMIT 1
      `)
        .bind(slug)
        .first<Record<string, unknown>>()

      if (!row) {
        return json({ ok: false, error: "wiki_page_not_found", slug }, 404)
      }

      void env.DB.prepare(`
      UPDATE wiki_pages
      SET view_count = view_count + 1,
          updated_at = datetime('now')
      WHERE slug = ?
    `)
        .bind(slug)
        .run()
        .catch(() => {
          // View counts are non-critical; never break page reads for analytics.
        })

      return json({
        ok: true,
        ...toWikiPageResponse(row),
      })
    }

    return json({ ok: false, error: "wiki_route_not_found" }, 404)
  } catch (error) {
    if (isMissingWikiSchemaError(error)) {
      return json(
        {
          ok: false,
          error: "wiki_schema_missing",
          status: "schema_missing",
          phase: "fail_soft",
          detail: "wiki tables are not initialized in D1",
        },
        503
      )
    }
    throw error
  }
}

export function toWikiPageResponse(row: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: row.slug,
    entity_type: row.entity_type,
    title: row.title,
    summary: row.summary,
    sections: safeJsonParse(row.sections_json as string, []),
    cross_refs: safeJsonParse(row.cross_refs_json as string, []),
    source_event_ids: safeJsonParse(row.source_event_ids_json as string, []),
    generated_at: row.generated_at,
    byok_provider: row.byok_provider,
    unverified_count: row.unverified_count,
    view_count: row.view_count,
    updated_at: row.updated_at,
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
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
