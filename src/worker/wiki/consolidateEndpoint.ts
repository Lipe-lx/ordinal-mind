// wiki/consolidateEndpoint.ts — GET /api/wiki/collection/:slug/consolidated

import type { Env } from "../index"
import { buildConsolidation } from "./consolidate"
import type { ConsolidatedCollection } from "../../app/lib/types"

export async function handleConsolidated(slug: string, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  try {
    // 1. Try to fetch from cache
    // A cache miss happens if it was never built or if it was invalidated
    // (deleted by a new published contribution).
    const cacheRow = await env.DB.prepare(`
      SELECT snapshot_json, updated_at
      FROM consolidated_cache
      WHERE collection_slug = ?
    `)
      .bind(slug)
      .first<{ snapshot_json: string; updated_at: string }>()

    if (cacheRow) {
      // Lazy rebuild condition: if cache is older than 1 hour.
      const updatedTime = new Date(cacheRow.updated_at).getTime()
      const now = Date.now()
      const oneHour = 60 * 60 * 1000

      if (now - updatedTime <= oneHour) {
        // Cache is fresh enough
        const data = JSON.parse(cacheRow.snapshot_json) as ConsolidatedCollection
        return json({ ok: true, data, cached: true })
      }
    }

    // 2. Cache miss or stale -> Rebuild consensus
    const consolidated = await buildConsolidation(slug, env)
    
    // 3. Save to cache
    await env.DB.prepare(`
      INSERT INTO consolidated_cache (
        collection_slug, snapshot_json, confidence, completeness, contribution_count, updated_at
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(collection_slug) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        confidence = excluded.confidence,
        completeness = excluded.completeness,
        contribution_count = excluded.contribution_count,
        updated_at = excluded.updated_at
    `)
      .bind(
        slug,
        JSON.stringify(consolidated),
        consolidated.confidence,
        consolidated.completeness.score,
        consolidated.sources.length
      )
      .run()

    return json({ ok: true, data: consolidated, cached: false })
  } catch (err) {
    console.error("[WikiConsolidated] Error:", err)
    return json({ ok: false, error: "consolidation_failed" }, 500)
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
