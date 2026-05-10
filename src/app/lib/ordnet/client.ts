// Ord.net API v1 — Authenticated client with token management and retry logic.
// All requests go directly from the browser to ord.net (CORS is enabled).
// No secrets are sent through the OrdinalMind server.

import type {
  OrdNetCollectionResponse,
  OrdNetListingsResponse,
  OrdNetSalesResponse,
  OrdNetMeResponse,
  OrdNetErrorResponse,
} from "./types"
import { getSession, clearSession } from "./auth"

const BASE_URL = "https://ord.net/api/v1"

// ─── Retry / rate-limit config ───────────────────────────────────────────────

const MAX_RETRIES = 2
const BACKOFF_BASE_MS = 1_000

// ─── Core authenticated fetch ────────────────────────────────────────────────

export class OrdNetApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: OrdNetErrorResponse | null,
    message?: string
  ) {
    super(message ?? body?.error ?? `ord.net API ${status}`)
    this.name = "OrdNetApiError"
  }

  get isAuthError(): boolean {
    return this.status === 401
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }

  get isForbidden(): boolean {
    return this.status === 403
  }
}

async function authenticatedFetch<T>(
  path: string,
  options?: { params?: Record<string, string>; signal?: AbortSignal }
): Promise<T> {
  const session = getSession()
  if (!session) {
    throw new OrdNetApiError(401, { error: "No active ord.net session" })
  }

  const url = new URL(`${BASE_URL}${path}`)
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value)
    }
  }

  let lastError: OrdNetApiError | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
      await sleep(delay)
    }

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
          "Content-Type": "application/json",
        },
        signal: options?.signal,
      })

      if (res.ok) {
        return (await res.json()) as T
      }

      const errorBody = await safeJsonParse<OrdNetErrorResponse>(res)
      lastError = new OrdNetApiError(res.status, errorBody)

      // 401 = token expired → clear session, don't retry
      if (res.status === 401) {
        clearSession()
        throw lastError
      }

      // 429 = rate limited → retry with backoff
      if (res.status === 429 && attempt < MAX_RETRIES) {
        continue
      }

      // 503 = temporary → retry
      if (res.status === 503 && attempt < MAX_RETRIES) {
        continue
      }

      // Any other error → don't retry
      throw lastError
    } catch (e) {
      if (e instanceof OrdNetApiError) throw e
      // Network error → retry
      if (attempt === MAX_RETRIES) {
        throw new OrdNetApiError(0, null, e instanceof Error ? e.message : "Network error")
      }
      lastError = new OrdNetApiError(0, null, e instanceof Error ? e.message : "Network error")
    }
  }

  throw lastError ?? new OrdNetApiError(0, null, "Exhausted retries")
}

// ─── Public API methods ──────────────────────────────────────────────────────

/**
 * Fetch inscriptions in a collection. Returns full item-card payloads
 * including traits, satributes, listing state, owner, and location.
 */
export async function fetchCollectionInscriptions(
  slug: string,
  options?: {
    limit?: number
    cursor?: string
    sort?: "oldest" | "newest"
    signal?: AbortSignal
  }
): Promise<OrdNetCollectionResponse> {
  const params: Record<string, string> = {}
  if (options?.limit) params.limit = String(options.limit)
  if (options?.cursor) params.cursor = options.cursor
  if (options?.sort) params.sort = options.sort

  return authenticatedFetch<OrdNetCollectionResponse>(
    `/collection/${encodeURIComponent(slug)}/inscriptions`,
    { params, signal: options?.signal }
  )
}

/**
 * Find a specific inscription within a collection's inscriptions.
 * Pages through results until the inscription is found or exhausted.
 */
export async function findInscriptionInCollection(
  slug: string,
  inscriptionId: string,
  options?: { signal?: AbortSignal }
): Promise<import("./types").OrdNetCollectionInscription | null> {
  let cursor: string | undefined
  const maxPages = 10 // Safety limit

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchCollectionInscriptions(slug, {
      limit: 100,
      cursor,
      sort: "oldest",
      signal: options?.signal,
    })

    const found = response.items.find(item => item.inscriptionId === inscriptionId)
    if (found) return found

    if (!response.pagination.hasNext || !response.pagination.nextCursor) {
      return null
    }

    cursor = response.pagination.nextCursor
  }

  return null
}

/**
 * Fetch active listings, optionally filtered by collection or inscription.
 */
export async function fetchListings(
  options?: {
    collectionSlug?: string
    inscriptionId?: string
    sellerAddress?: string
    sort?: "recent" | "price"
    limit?: number
    cursor?: string
    signal?: AbortSignal
  }
): Promise<OrdNetListingsResponse> {
  const params: Record<string, string> = {}
  if (options?.collectionSlug) params.collectionSlug = options.collectionSlug
  if (options?.inscriptionId) params.inscriptionId = options.inscriptionId
  if (options?.sellerAddress) params.sellerAddress = options.sellerAddress
  if (options?.sort) params.sort = options.sort
  if (options?.limit) params.limit = String(options.limit)
  if (options?.cursor) params.cursor = options.cursor

  return authenticatedFetch<OrdNetListingsResponse>("/listings", {
    params,
    signal: options?.signal,
  })
}

/**
 * Fetch confirmed sales, optionally filtered by collection.
 */
export async function fetchSales(
  options?: {
    collectionSlug?: string
    limit?: number
    cursor?: string
    signal?: AbortSignal
  }
): Promise<OrdNetSalesResponse> {
  const params: Record<string, string> = {}
  if (options?.collectionSlug) params.collectionSlug = options.collectionSlug
  if (options?.limit) params.limit = String(options.limit)
  if (options?.cursor) params.cursor = options.cursor

  return authenticatedFetch<OrdNetSalesResponse>("/sales", {
    params,
    signal: options?.signal,
  })
}

/**
 * Fetch the current user profile and wallet bindings.
 */
export async function fetchMe(
  options?: { signal?: AbortSignal }
): Promise<OrdNetMeResponse> {
  return authenticatedFetch<OrdNetMeResponse>("/me", {
    signal: options?.signal,
  })
}

/**
 * Check if the client has an active, non-expired ord.net session.
 */
export function hasActiveSession(): boolean {
  const session = getSession()
  if (!session) return false
  return new Date(session.expiresAt).getTime() > Date.now()
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function safeJsonParse<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}
