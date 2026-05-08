import { useCallback, useEffect, useState } from "react"

const POLL_INTERVAL_MS = 30000

export interface WikiReviewItem {
  id: string
  collection_slug: string
  field: string
  proposed_value: string
  confidence: string
  verifiable: boolean
  contributor_id: string | null
  contributor_username: string | null
  contributor_tier: string
  session_id: string
  source_excerpt: string | null
  created_at: string
  current_value: string | null
  current_tier: string | null
}

interface PendingReviewsResponse {
  ok: boolean
  pending_count: number
  items: WikiReviewItem[]
}

interface PendingReviewsPartialResponse {
  ok?: boolean
  pending_count?: number
  items?: WikiReviewItem[]
  partial?: boolean
  error?: string
}

interface PendingReviewsFetchResult {
  kind: "ok" | "partial"
  payload: PendingReviewsResponse
}

function normalizePendingReviewsPayload(payload: unknown): PendingReviewsPartialResponse {
  if (!payload || typeof payload !== "object") return {}
  return payload as PendingReviewsPartialResponse
}

async function fetchPendingReviews(): Promise<PendingReviewsFetchResult> {
  const response = await fetch("/api/wiki/reviews/pending", {
    credentials: "same-origin",
  })

  const payload = normalizePendingReviewsPayload(await response.json().catch(() => ({})))
  if (response.ok && payload.ok === true) {
    return {
      kind: "ok",
      payload: {
        ok: true,
        pending_count: Number.isFinite(payload.pending_count) ? Number(payload.pending_count) : 0,
        items: Array.isArray(payload.items) ? payload.items : [],
      },
    }
  }

  // Backends in partial mode may not expose pending reviews reliably.
  // Treat this as degraded-but-non-fatal to avoid repetitive UI error noise.
  if (payload.partial === true) {
    return {
      kind: "partial",
      payload: {
        ok: true,
        pending_count: 0,
        items: [],
      },
    }
  }

  throw new Error(typeof payload.error === "string" ? payload.error : "review_fetch_failed")
}

async function sendReviewAction(reviewId: string, action: "approve" | "reject"): Promise<void> {
  const response = await fetch(`/api/wiki/reviews/${encodeURIComponent(reviewId)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "review_action_failed")
  }
}

export function useWikiReviewQueue(enabled: boolean) {
  const [items, setItems] = useState<WikiReviewItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!enabled) {
      setItems([])
      setPendingCount(0)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    try {
      const result = await fetchPendingReviews()
      setItems(result.payload.items)
      setPendingCount(result.payload.pending_count)
      if (result.kind === "ok") {
        setError(null)
      } else if (!options?.silent) {
        setError("Review queue is temporarily unavailable.")
      }
    } catch (nextError) {
      if (!options?.silent) {
        setError(nextError instanceof Error ? nextError.message : "review_fetch_failed")
      }
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
    if (!enabled) return

    const intervalId = window.setInterval(() => {
      void refresh({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [enabled, refresh])

  const applyAction = useCallback(async (reviewId: string, action: "approve" | "reject") => {
    setActingId(reviewId)
    try {
      await sendReviewAction(reviewId, action)
      setItems((prev) => prev.filter((item) => item.id !== reviewId))
      setPendingCount((prev) => Math.max(0, prev - 1))
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "review_action_failed")
      throw nextError
    } finally {
      setActingId(null)
    }
  }, [])

  return {
    items,
    pendingCount,
    loading,
    error,
    actingId,
    refresh,
    approveReview: (reviewId: string) => applyAction(reviewId, "approve"),
    rejectReview: (reviewId: string) => applyAction(reviewId, "reject"),
  }
}
