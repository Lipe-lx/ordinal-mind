// wiki/consolidateEndpoint.ts — GET /api/wiki/collection/:slug/consolidated

import type { Env } from "../index"
import { buildConsolidation } from "./consolidate"
import type { ConsolidatedCollection } from "../../app/lib/types"
import { buildCollectionSlugAliases, normalizeCollectionSlugInput } from "./slugAliases"

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

  const aliases = buildCollectionSlugAliases(slug)
  const placeholders = aliases.map(() => "?").join(", ")

  const rows = await env.DB.prepare(`
    SELECT id, field, status, contributor_key, created_at
    FROM wiki_contributions
    WHERE collection_slug IN (${placeholders})
      AND status IN ('published', 'quarantine')
    ORDER BY datetime(created_at) DESC, id DESC
  `)
    .bind(...aliases)
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

  const duplicatePlaceholders = duplicateIds.map(() => "?").join(", ")
  await env.DB.prepare(`
    UPDATE wiki_contributions
    SET
      status = 'duplicate',
      reviewed_at = COALESCE(reviewed_at, datetime('now')),
      updated_at = datetime('now')
    WHERE id IN (${duplicatePlaceholders})
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

  const normalizedSlug = normalizeCollectionSlugInput(slug)
  const aliases = buildCollectionSlugAliases(normalizedSlug)

  const cleanedLegacy = await cleanupLegacyActiveDuplicates(normalizedSlug, env)
  if (cleanedLegacy) {
    await env.DB.prepare(`
      DELETE FROM consolidated_cache
      WHERE collection_slug = ?
    `)
      .bind(normalizedSlug)
      .run()
  }

  let cacheRow: { snapshot_json: string; updated_at: string } | null = null
  if (aliases.length <= 1) {
    cacheRow = await env.DB.prepare(`
    SELECT snapshot_json, updated_at
    FROM consolidated_cache
    WHERE collection_slug = ?
  `)
      .bind(normalizedSlug)
      .first<{ snapshot_json: string; updated_at: string }>()
  }

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

  const consolidated = await buildConsolidation(normalizedSlug, env)

  // Proactive seed: if the collection has data, ensure it exists in the search index (wiki_pages)
  // This allows it to be found in MCP even without a full narrative.
  if (env.DB) {
    const isInscription = /^[a-f0-9]{64}i[0-9]+$/i.test(normalizedSlug)
    const entityType = isInscription ? "inscription" : "collection"
    const wikiSlug = `${entityType}:${normalizedSlug}`

    if (consolidated.completeness.score > 0) {
      // For inscriptions, try to find a parent collection to link back to via on-chain/market data
      let crossRefs = "[]"
      if (isInscription) {
        const link = await env.DB.prepare(`
          SELECT json_extract(metadata_json, '$.parent_inscription_id') as parent_id,
                 json_extract(metadata_json, '$.name') as collection_name
          FROM raw_chronicle_events
          WHERE inscription_id = ? AND event_type = 'collection_link'
          LIMIT 1
        `).bind(normalizedSlug).first<{ parent_id: string | null, collection_name: string | null }>()

        const parentRef = link?.parent_id || link?.collection_name
        if (parentRef) {
          crossRefs = JSON.stringify([`collection:${normalizeCollectionSlugInput(parentRef)}`].filter(Boolean))
        }
      }

      await env.DB.prepare(`
        INSERT INTO wiki_pages
          (slug, entity_type, title, summary, sections_json, cross_refs_json,
           source_event_ids_json, generated_at, byok_provider, unverified_count, updated_at)
        VALUES (?, ?, ?, '', '[]', ?, '[]', datetime('now'), 'system_seed', 0, datetime('now'))
        ON CONFLICT(slug) DO UPDATE SET
          entity_type = excluded.entity_type,
          title = excluded.title,
          cross_refs_json = CASE WHEN excluded.cross_refs_json <> '[]' THEN excluded.cross_refs_json ELSE wiki_pages.cross_refs_json END,
          updated_at = excluded.updated_at
      `)
        .bind(wikiSlug, entityType, consolidated.narrative["name"]?.canonical_value || normalizedSlug, crossRefs)
        .run()
        .catch(() => {
          // Seed errors are ignored
        })
    } else {
      // If completeness dropped to zero (e.g., after Genesis deletion), remove from search index
      await env.DB.prepare(`DELETE FROM wiki_pages WHERE slug = ?`)
        .bind(wikiSlug)
        .run()
        .catch(() => {})
    }
  }

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
      normalizedSlug,
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
