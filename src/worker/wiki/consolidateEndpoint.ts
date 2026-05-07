// wiki/consolidateEndpoint.ts — GET /api/wiki/collection/:slug/consolidated

import type { Env } from "../index"
import { buildConsolidation } from "./consolidate"
import type { ConsolidatedCollection } from "../../app/lib/types"

export interface ConsolidatedSnapshotResult {
  data: ConsolidatedCollection
  cached: boolean
}

interface TableInfoRow {
  name: string
}

interface LegacyActiveContributionRow {
  id: string
  field: string
  status: "published" | "quarantine"
  contributor_key: string
  created_at: string
}

async function hasLazyCleanupColumns(env: Env): Promise<boolean> {
  if (!env.DB) return false

  try {
    const columns = await env.DB.prepare("PRAGMA table_info('wiki_contributions')")
      .all<TableInfoRow>()
    const names = new Set((columns.results ?? []).map((row) => row.name))
    return names.has("contributor_key") && names.has("updated_at")
  } catch {
    return false
  }
}

async function cleanupLegacyActiveDuplicates(slug: string, env: Env): Promise<boolean> {
  if (!env.DB) return false
  const hasColumns = await hasLazyCleanupColumns(env)
  if (!hasColumns) return false

  const rows = await env.DB.prepare(`
    SELECT id, field, status, contributor_key, created_at
    FROM wiki_contributions
    WHERE collection_slug = ?
      AND status IN ('published', 'quarantine')
    ORDER BY datetime(created_at) DESC, id DESC
  `)
    .bind(slug)
    .all<LegacyActiveContributionRow>()

  const seen = new Set<string>()
  const duplicateIds: string[] = []

  for (const row of rows.results ?? []) {
    const key = `${row.field}|${row.status}|${row.contributor_key}`
    if (seen.has(key)) {
      duplicateIds.push(row.id)
      continue
    }
    seen.add(key)
  }

  if (duplicateIds.length === 0) return false

  const placeholders = duplicateIds.map(() => "?").join(", ")
  await env.DB.prepare(`
    UPDATE wiki_contributions
    SET
      status = 'duplicate',
      reviewed_at = COALESCE(reviewed_at, datetime('now')),
      updated_at = datetime('now')
    WHERE id IN (${placeholders})
  `)
    .bind(...duplicateIds)
    .run()

  return true
}

export async function getConsolidatedSnapshot(
  slug: string,
  env: Env
): Promise<ConsolidatedSnapshotResult> {
  if (!env.DB) {
    throw new Error("wiki_db_unavailable")
  }

  const cleanedLegacy = await cleanupLegacyActiveDuplicates(slug, env)
  if (cleanedLegacy) {
    await env.DB.prepare(`
      DELETE FROM consolidated_cache
      WHERE collection_slug = ?
    `)
      .bind(slug)
      .run()
  }

  const cacheRow = await env.DB.prepare(`
    SELECT snapshot_json, updated_at
    FROM consolidated_cache
    WHERE collection_slug = ?
  `)
    .bind(slug)
    .first<{ snapshot_json: string; updated_at: string }>()

  if (cacheRow) {
    const updatedTime = new Date(cacheRow.updated_at).getTime()
    const now = Date.now()
    const oneHour = 60 * 60 * 1000

    if (Number.isFinite(updatedTime) && now - updatedTime <= oneHour) {
      try {
        return {
          data: JSON.parse(cacheRow.snapshot_json) as ConsolidatedCollection,
          cached: true,
        }
      } catch {
        // Ignore corrupted cache rows and rebuild below.
      }
    }
  }

  const consolidated = await buildConsolidation(slug, env)

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

  return {
    data: consolidated,
    cached: false,
  }
}

export async function handleConsolidated(slug: string, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  try {
    const consolidated = await getConsolidatedSnapshot(slug, env)
    return json({ ok: true, data: consolidated.data, cached: consolidated.cached })
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
