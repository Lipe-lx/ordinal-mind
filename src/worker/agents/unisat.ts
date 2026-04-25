// UniSat Open API agent — enriches inscriptions with traits, charms, and marketplace data.
// Base: https://open-api.unisat.io
// Auth: Bearer token from env.UNISAT_API_KEY (server-side secret, not BYOK).
//
// Provides: inscription metadata (charms, sat, metaprotocol), collection stats (floor, volume),
// collection items with trait attributes (for rarity computation), marketplace listing info,
// and activity history (sales, listings, delists).
//
// Rate limit: Free tier = 5 req/s, 2000/day. We use 200ms delay between sequential calls.

const UNISAT_BASE_URL = "https://open-api.unisat.io"
const MAX_RETRIES = 3
const BACKOFF_BASE = 1.5

// --- Response Types ---

export interface UnisatInscriptionInfo {
  inscriptionId: string
  inscriptionNumber: number
  address: string
  contentType: string
  contentLength: number
  height: number
  timestamp: number
  sat: number
  genesisTransaction: string
  offset: number
  charms: string[]
  metaprotocol: string | null
  attributes?: { trait_type: string; value: string }[]
}

// --- Public API ---

// --- Internal helpers ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface UnisatEnvelope<T> {
  code: number
  msg: string
  data: T
}

async function unisatGet<T>(path: string, apiKey: string): Promise<T | null> {
  return callWithRetry(async () => {
    const res = await fetch(`${UNISAT_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })

    if (res.status === 429) {
      const err = new Error("UniSat rate limited")
      ;(err as unknown as Record<string, number>).status = 429
      throw err
    }

    if (!res.ok) return null

    const envelope = (await res.json()) as UnisatEnvelope<T>
    if (envelope.code !== 0) {
      // Non-zero codes are expected for inscriptions not in the index — silently return null
      return null
    }

    return envelope.data
  })
}

// Removed POST and retry logic for market endpoints since we only use GET for the indexer

async function callWithRetry<T>(fn: () => Promise<T | null>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as Record<string, unknown>).status
      if (status === 429) {
        const wait = BACKOFF_BASE ** attempt * 1000
        await sleep(wait)
        continue
      }
      // Non-rate-limit error — don't retry
      console.error("UniSat fetch error:", err)
      return null
    }
  }
  console.error("UniSat: max retries exceeded")
  return null
}

// Pagination helpers removed

// --- Public API ---

export const fetchUnisat = {
  /**
   * Fetch full inscription info from UniSat indexer.
   * Returns charms, sat number, metaprotocol, content length, etc.
   */
  async inscription(id: string, apiKey: string): Promise<UnisatInscriptionInfo | null> {
    if (!apiKey) return null
    return unisatGet<UnisatInscriptionInfo>(
      `/v1/indexer/inscription/info/${id}`,
      apiKey
    )
  },
}
