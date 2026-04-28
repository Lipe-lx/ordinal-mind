import type { Env } from "../index"
import { getWikiSchemaFailure } from "./schema"
import type { WikiPageDraft, WikiSection } from "./types"

export async function handleIngest(request: Request, env: Env): Promise<Response> {
  const schemaFailure = await getWikiSchemaFailure(env)
  if (schemaFailure) return json(schemaFailure, 503)
  if (!env.DB) return json({ ok: false, error: "wiki_db_unavailable", phase: "fail_soft" }, 503)

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400)
  }

  const draft = sanitizeDraft(payload)
  if (!draft) {
    return json({ ok: false, error: "invalid_wiki_draft" }, 422)
  }

  if (draft.source_event_ids.length === 0) {
    return json({ ok: false, error: "source_event_ids_required" }, 422)
  }

  const placeholders = draft.source_event_ids.map(() => "?").join(",")
  const found = await env.DB.prepare(
    `SELECT id FROM raw_chronicle_events WHERE id IN (${placeholders})`
  )
    .bind(...draft.source_event_ids)
    .all<{ id: string }>()

  const foundSet = new Set((found.results ?? []).map((row) => row.id))
  const unverifiedIds = draft.source_event_ids.filter((id) => !foundSet.has(id))

  const normalizedSections = draft.sections.map((section) => {
    const verifiedIds = section.source_event_ids.filter((id) => foundSet.has(id))
    return {
      ...section,
      source_event_ids: verifiedIds,
      unverified_claims: section.source_event_ids.some((id) => !foundSet.has(id)),
    }
  })

  const now = new Date().toISOString()

  await env.DB.prepare(`
    INSERT INTO wiki_pages
      (slug, entity_type, title, summary, sections_json, cross_refs_json,
       source_event_ids_json, generated_at, byok_provider, unverified_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      entity_type = excluded.entity_type,
      title = excluded.title,
      summary = excluded.summary,
      sections_json = excluded.sections_json,
      cross_refs_json = excluded.cross_refs_json,
      source_event_ids_json = excluded.source_event_ids_json,
      generated_at = excluded.generated_at,
      byok_provider = excluded.byok_provider,
      unverified_count = excluded.unverified_count,
      updated_at = excluded.updated_at
  `)
    .bind(
      draft.slug,
      draft.entity_type,
      draft.title,
      draft.summary,
      JSON.stringify(normalizedSections),
      JSON.stringify(draft.cross_refs),
      JSON.stringify(draft.source_event_ids),
      draft.generated_at,
      draft.byok_provider,
      unverifiedIds.length,
      now
    )
    .run()

  void env.DB.prepare(`
    INSERT INTO wiki_log (operation, slug, detail_json)
    VALUES ('ingest', ?, ?)
  `)
    .bind(
      draft.slug,
      JSON.stringify({
        provider: draft.byok_provider,
        section_count: normalizedSections.length,
        unverified_count: unverifiedIds.length,
      })
    )
    .run()
    .catch(() => {
      // Audit logs are best-effort; page ingestion has already succeeded.
    })

  return json({ ok: true, slug: draft.slug, unverified_count: unverifiedIds.length })
}

function sanitizeDraft(payload: unknown): WikiPageDraft | null {
  if (!payload || typeof payload !== "object") return null

  const candidate = payload as Record<string, unknown>
  const slug = asString(candidate.slug)
  const entityType = asString(candidate.entity_type)
  const title = asString(candidate.title)
  const summary = asString(candidate.summary)
  const generatedAt = asString(candidate.generated_at)
  const byokProvider = asString(candidate.byok_provider)

  if (!slug || !title || !summary || !generatedAt || !byokProvider) return null
  if (!isEntityType(entityType)) return null

  const sections = asSections(candidate.sections)
  const crossRefs = asStringArray(candidate.cross_refs)
  const sourceEventIds = asStringArray(candidate.source_event_ids)

  return {
    slug,
    entity_type: entityType,
    title,
    summary,
    sections,
    cross_refs: crossRefs,
    source_event_ids: sourceEventIds,
    generated_at: generatedAt,
    byok_provider: byokProvider,
  }
}

function asSections(value: unknown): WikiSection[] {
  if (!Array.isArray(value)) return []
  const sections: WikiSection[] = []

  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const heading = asString(record.heading)
    const body = asString(record.body)
    if (!heading || !body) continue

    sections.push({
      heading,
      body,
      source_event_ids: asStringArray(record.source_event_ids),
    })
  }

  return sections
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function isEntityType(value: string): value is WikiPageDraft["entity_type"] {
  return value === "inscription" || value === "collection" || value === "artist" || value === "sat"
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
