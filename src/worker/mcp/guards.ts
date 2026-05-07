import type { ChronicleEvent } from "../../app/lib/types"

export const MCP_LIMITS = {
  MAX_PROVENANCE_DEPTH: 50,
  MAX_EVENT_WINDOW_DAYS: 1825,
  MAX_COLLECTION_LINKS: 20,
  MAX_RESOURCE_SIZE_KB: 512,
  MAX_WIKI_CONTRIBUTION_LEN: 2000,
  MAX_REINDEX_ITEMS: 30,
} as const

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function guardProvenanceDepth(events: ChronicleEvent[]): ChronicleEvent[] {
  if (events.length <= MCP_LIMITS.MAX_PROVENANCE_DEPTH) return events
  return events.slice(0, MCP_LIMITS.MAX_PROVENANCE_DEPTH)
}

export function guardEventWindow(events: ChronicleEvent[]): ChronicleEvent[] {
  if (events.length === 0) return events
  const latestTs = new Date(events[events.length - 1].timestamp).getTime()
  if (!Number.isFinite(latestTs)) return events

  const minTs = latestTs - (MCP_LIMITS.MAX_EVENT_WINDOW_DAYS * MS_PER_DAY)
  return events.filter((event) => {
    const ts = new Date(event.timestamp).getTime()
    if (!Number.isFinite(ts)) return false
    return ts >= minTs
  })
}

export function guardCollectionLinks<T>(items: T[]): T[] {
  if (items.length <= MCP_LIMITS.MAX_COLLECTION_LINKS) return items
  return items.slice(0, MCP_LIMITS.MAX_COLLECTION_LINKS)
}

export function serializeGuardedResource(data: unknown): string {
  const text = JSON.stringify(data)
  const maxBytes = MCP_LIMITS.MAX_RESOURCE_SIZE_KB * 1024
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes <= maxBytes) return text

  return JSON.stringify({
    ok: false,
    error: "resource_payload_too_large",
    partial: true,
    size_bytes: bytes,
    max_bytes: maxBytes,
  })
}

export function limitWikiContributionValue(value: string): string {
  if (value.length <= MCP_LIMITS.MAX_WIKI_CONTRIBUTION_LEN) return value
  return value.slice(0, MCP_LIMITS.MAX_WIKI_CONTRIBUTION_LEN)
}
