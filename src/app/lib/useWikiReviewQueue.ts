import { useCallback, useEffect, useState } from "react"

const DISCORD_JWT_STORAGE_KEY = "ordinal-mind_discord_jwt"
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

function readJWT(): string | null {
  try {
    return localStorage.getItem(DISCORD_JWT_STORAGE_KEY)
  } catch {
    return null
  }
}

async function fetchPendingReviews(): Promise<PendingReviewsResponse> {
  const jwt = readJWT()
  const response = await fetch("/api/wiki/reviews/pending", {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "review_fetch_failed")
  }

  return payload as PendingReviewsResponse
}

async function sendReviewAction(reviewId: string, action: "approve" | "reject"): Promise<void> {
  const jwt = readJWT()
  const response = await fetch(`/api/wiki/reviews/${encodeURIComponent(reviewId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
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

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([])
      setPendingCount(0)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    try {
      const payload = await fetchPendingReviews()
      setItems(payload.items)
      setPendingCount(payload.pending_count)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "review_fetch_failed")
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
    if (!enabled) return

    const intervalId = window.setInterval(() => {
      void refresh()
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
