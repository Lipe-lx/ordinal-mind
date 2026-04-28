import type { ChronicleEvent } from "../../app/lib/types"
import type { Env } from "../index"

export async function persistRawEvents(
  env: Env,
  inscriptionId: string,
  events: ChronicleEvent[]
): Promise<void> {
  if (!env.DB || events.length === 0) return

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

  await env.DB.batch(batch)
}
