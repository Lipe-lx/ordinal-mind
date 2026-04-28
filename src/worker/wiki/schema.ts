import type { Env } from "../index"

export type WikiSchemaStatus =
  | "ready"
  | "db_unavailable"
  | "schema_missing"
  | "schema_incomplete"

export interface WikiSchemaHealth {
  ok: boolean
  ready: boolean
  status: WikiSchemaStatus
  error?: string
  phase?: "fail_soft"
  detail?: string
  present_objects: string[]
  missing_objects: string[]
  checked_at: string
}

const REQUIRED_WIKI_OBJECTS = [
  "raw_chronicle_events",
  "wiki_pages",
  "wiki_log",
  "wiki_fts",
] as const

export async function checkWikiSchema(env: Env): Promise<WikiSchemaHealth> {
  const checkedAt = new Date().toISOString()

  if (!env.DB) {
    return {
      ok: false,
      ready: false,
      status: "db_unavailable",
      error: "wiki_db_unavailable",
      phase: "fail_soft",
      detail: "D1 binding DB is not available.",
      present_objects: [],
      missing_objects: [...REQUIRED_WIKI_OBJECTS],
      checked_at: checkedAt,
    }
  }

  try {
    const rows = await env.DB.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE name IN (?, ?, ?, ?)
    `)
      .bind(...REQUIRED_WIKI_OBJECTS)
      .all<{ name: string }>()

    const present = new Set((rows.results ?? []).map((row) => row.name))
    const presentObjects = REQUIRED_WIKI_OBJECTS.filter((name) => present.has(name))
    const missingObjects = REQUIRED_WIKI_OBJECTS.filter((name) => !present.has(name))

    if (missingObjects.length === 0) {
      return {
        ok: true,
        ready: true,
        status: "ready",
        present_objects: presentObjects,
        missing_objects: [],
        checked_at: checkedAt,
      }
    }

    const status: WikiSchemaStatus = presentObjects.length === 0
      ? "schema_missing"
      : "schema_incomplete"

    return {
      ok: false,
      ready: false,
      status,
      error: toWikiSchemaError(status),
      phase: "fail_soft",
      detail: "Wiki D1 schema is not fully initialized.",
      present_objects: presentObjects,
      missing_objects: missingObjects,
      checked_at: checkedAt,
    }
  } catch (error) {
    const status: WikiSchemaStatus = isMissingWikiSchemaError(error)
      ? "schema_missing"
      : "schema_incomplete"

    return {
      ok: false,
      ready: false,
      status,
      error: toWikiSchemaError(status),
      phase: "fail_soft",
      detail: error instanceof Error ? error.message : String(error),
      present_objects: [],
      missing_objects: [...REQUIRED_WIKI_OBJECTS],
      checked_at: checkedAt,
    }
  }
}

export async function getWikiSchemaFailure(env: Env): Promise<WikiSchemaHealth | null> {
  const health = await checkWikiSchema(env)
  return health.ready ? null : health
}

export function wikiHealthStatusCode(health: WikiSchemaHealth): number {
  return health.ready ? 200 : 503
}

export function toWikiToolUnavailable(health: WikiSchemaHealth): Record<string, unknown> {
  return {
    ok: false,
    error: health.error ?? toWikiSchemaError(health.status),
    status: health.status,
    partial: true,
    phase: "fail_soft",
    missing_objects: health.missing_objects,
  }
}

export function toWikiSchemaError(status: WikiSchemaStatus): string {
  switch (status) {
    case "ready":
      return ""
    case "db_unavailable":
      return "wiki_db_unavailable"
    case "schema_incomplete":
      return "wiki_schema_incomplete"
    case "schema_missing":
    default:
      return "wiki_schema_missing"
  }
}

export function isMissingWikiSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("no such table")
    || message.includes("no such module: fts5")
    || message.includes("no such module: wiki_fts")
  )
}
