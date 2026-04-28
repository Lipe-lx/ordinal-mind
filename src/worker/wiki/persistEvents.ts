import type { ChronicleEvent } from "../../app/lib/types"
import type { Env } from "../index"
import { getWikiSchemaFailure, isMissingWikiSchemaError, type WikiSchemaStatus } from "./schema"

export interface PersistRawEventsResult {
  ok: boolean
  status: WikiSchemaStatus | "skipped" | "failed"
  event_count: number
  error?: string
}

export async function persistRawEvents(
  env: Env,
  inscriptionId: string,
  events: ChronicleEvent[]
): Promise<PersistRawEventsResult> {
  if (events.length === 0) {
    return { ok: true, status: "skipped", event_count: 0 }
  }

  const schemaFailure = await getWikiSchemaFailure(env)
  if (schemaFailure || !env.DB) {
    return {
      ok: false,
      status: schemaFailure?.status ?? "db_unavailable",
      event_count: events.length,
      error: schemaFailure?.error ?? "wiki_db_unavailable",
    }
  }

  const stmt = env.DB.prepare(`
    INSERT OR IGNORE INTO raw_chronicle_events
      (id, inscription_id, event_type, timestamp, block_height,
       source_type, source_ref, description, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const batch = events.map((event) =>
    stmt.bind(
      event.id,
      inscriptionId,
      event.event_type,
      event.timestamp ?? null,
      event.block_height ?? null,
      event.source.type,
      event.source.ref,
      event.description,
      JSON.stringify(event.metadata ?? {})
    )
  )

  try {
    await env.DB.batch(batch)
    return { ok: true, status: "ready", event_count: events.length }
  } catch (error) {
    if (isMissingWikiSchemaError(error)) {
      return {
        ok: false,
        status: "schema_missing",
        event_count: events.length,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return {
      ok: false,
      status: "failed",
      event_count: events.length,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
