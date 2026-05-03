// wiki/completeness.ts — GET /api/wiki/collection/:slug/completeness
// Pillar 2 — Chat Wiki Builder
//
// Calculates which of the 9 canonical fields for a collection have published
// contributions. Used by the frontend to inject completeness context into the
// Wiki Builder prompt before each chat turn.

import type { Env } from "../index"
import { CANONICAL_FIELDS, type CanonicalField } from "./contribute"

export interface CollectionCanonicalFields {
  founder: string | null
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
    founder: null,
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

  const fields = emptyFields()

  try {
    // Fetch the most recent published contribution per canonical field.
    // If multiple published contributions exist for the same field,
    // we take the highest-tier one (genesis > og > community > anon),
    // then most recent as tiebreaker.
    const rows = await env.DB.prepare(`
      SELECT field, value
      FROM wiki_contributions
      WHERE collection_slug = ?
        AND status = 'published'
        AND field IN (${CANONICAL_FIELDS.map(() => "?").join(", ")})
      GROUP BY field
      HAVING id = (
        SELECT id FROM wiki_contributions wc2
        WHERE wc2.collection_slug = wiki_contributions.collection_slug
          AND wc2.field = wiki_contributions.field
          AND wc2.status = 'published'
        ORDER BY
          CASE og_tier
            WHEN 'genesis'   THEN 4
            WHEN 'og'        THEN 3
            WHEN 'community' THEN 2
            ELSE 1
          END DESC,
          created_at DESC
        LIMIT 1
      )
    `)
      .bind(slug, ...CANONICAL_FIELDS)
      .all<{ field: string; value: string }>()

    for (const row of rows.results ?? []) {
      const field = row.field as CanonicalField
      if (field in fields) {
        ;(fields as unknown as Record<string, string | null>)[field] = row.value
      }
    }
  } catch (err) {
    console.error("[WikiCompleteness] D1 query failed:", err)
    // Return an empty completeness map rather than 500 — fail soft
  }

  const filledFields = CANONICAL_FIELDS.filter((f) => fields[f] !== null)
  const missingFields = CANONICAL_FIELDS.filter((f) => fields[f] === null)
  const filled = filledFields.length
  const total = CANONICAL_FIELDS.length

  const completeness: CompletenessMap = {
    collection_slug: slug,
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
