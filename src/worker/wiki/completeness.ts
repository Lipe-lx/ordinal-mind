// wiki/completeness.ts — GET /api/wiki/collection/:slug/completeness
// Pillar 2 — Chat Wiki Builder
//
// Calculates which of the 9 canonical fields for a collection have published
// contributions. Used by the frontend to inject completeness context into the
// Wiki Builder prompt before each chat turn.

import type { Env } from "../index"
import { CANONICAL_FIELDS, type CanonicalField } from "./contribute"
import { buildCollectionSlugAliases, normalizeCollectionSlugInput } from "./slugAliases"

export interface CollectionCanonicalFields {
  name: string | null
  founder: string | null
  artist: string | null
  inscriber: string | null
  launch_date: string | null
  launch_context: string | null
  origin_narrative: string | null
  technical_details: string | null
  notable_moments: string | null
  community_culture: string | null
  connections: string | null
  current_status: string | null
}

export interface CompletenessMap {
  collection_slug: string
  filled: number
  total: number
  score: number  // 0.0–1.0
  missing_fields: CanonicalField[]
  fields: CollectionCanonicalFields
}

function emptyFields(): CollectionCanonicalFields {
  return {
    name: null,
    founder: null,
    artist: null,
    inscriber: null,
    launch_date: null,
    launch_context: null,
    origin_narrative: null,
    technical_details: null,
    notable_moments: null,
    community_culture: null,
    connections: null,
    current_status: null,
  }
}

export async function handleCompleteness(slug: string, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "wiki_db_unavailable" }, 503)
  }

  const normalizedSlug = normalizeCollectionSlugInput(slug)
  const aliases = buildCollectionSlugAliases(normalizedSlug)
  const slugPlaceholders = aliases.map(() => "?").join(", ")

  const fields = emptyFields()

  try {
    // Fetch all published candidates across historical aliases and choose
    // the highest-tier/most recent row per field in-memory.
    const rows = await env.DB.prepare(`
      SELECT field, value, og_tier, created_at, id
      FROM wiki_contributions
      WHERE collection_slug IN (${slugPlaceholders})
        AND status = 'published'
        AND field IN (${CANONICAL_FIELDS.map(() => "?").join(", ")})
      ORDER BY
        CASE og_tier
          WHEN 'genesis'   THEN 4
          WHEN 'og'        THEN 3
          WHEN 'community' THEN 2
          ELSE 1
        END DESC,
        datetime(created_at) DESC,
        id DESC
    `)
      .bind(...aliases, ...CANONICAL_FIELDS)
      .all<{ field: string; value: string }>()

    const selected = new Set<string>()
    for (const row of rows.results ?? []) {
      const field = row.field as CanonicalField
      if (selected.has(field)) continue
      if (field in fields) {
        ;(fields as unknown as Record<string, string | null>)[field] = row.value
        selected.add(field)
      }
    }
  } catch (err) {
    console.error("[WikiCompleteness] D1 query failed:", err)
    // Return an empty completeness map rather than 500 — fail soft
  }

  const fieldsRecord = fields as unknown as Record<CanonicalField, string | null>
  const filledFields = CANONICAL_FIELDS.filter((f) => fieldsRecord[f] !== null)
  const missingFields = CANONICAL_FIELDS.filter((f) => fieldsRecord[f] === null)
  const filled = filledFields.length
  const total = CANONICAL_FIELDS.length

  const completeness: CompletenessMap = {
    collection_slug: normalizedSlug,
    filled,
    total,
    score: total > 0 ? Math.round((filled / total) * 1000) / 1000 : 0,
    missing_fields: missingFields,
    fields,
  }

  return json({ ok: true, ...completeness })
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
