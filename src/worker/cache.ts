// KV cache layer with TTL strategy.
// Immutable genesis data → 30-day TTL
// Recent inscriptions (< 7 days old) → 1-hour TTL

import type { Chronicle } from "../app/lib/types"

const TTL = {
  default: 60 * 60 * 24 * 30, // 30 days — immutable on-chain data
  recent: 60 * 60,            // 1 hour — for inscriptions < 7 days old
} as const

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function cacheGet(kv: KVNamespace, id: string): Promise<Chronicle | null> {
  const raw = await kv.get(id)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Chronicle
  } catch {
    return null
  }
}

export async function cachePut(kv: KVNamespace, id: string, chronicle: Chronicle): Promise<void> {
  const genesisTs = new Date(chronicle.meta.genesis_timestamp).getTime()
  const isRecent = Date.now() - genesisTs < SEVEN_DAYS_MS
  const ttl = isRecent ? TTL.recent : TTL.default

  await kv.put(id, JSON.stringify(chronicle), { expirationTtl: ttl })
}
