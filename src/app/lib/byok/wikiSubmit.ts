// wikiSubmit.ts — Shared wiki contribution submission utility.
// Used by both useChronicleNarrativeChat (chat-extracted contributions)
// and wikiSeedAgent (narrative-derived seed contributions).
//
// The server never receives, stores, or proxies the user's LLM key.
// All calls go to the public POST /api/wiki/contribute endpoint.

import type { CanonicalField } from "./wikiCompleteness"

export interface WikiContributionPayload {
  collection_slug: string
  field: CanonicalField
  value: string
  operation?: "add" | "delete"
  origin?: "narrative_seed_agent"
  confidence: "stated_by_user" | "inferred" | "correcting_existing"
  verifiable: boolean
  session_id?: string | null
  source_excerpt?: string
  /** Forward-compat: WikiExtractData uses source_chat_excerpt; accepted and forwarded as-is. */
  source_chat_excerpt?: string
}

export interface WikiSubmitResult {
  ok: true
  status?: string
  tier_applied?: string
  detail?: string
}

export interface WikiSubmitError {
  ok: false
  error: string
}

/**
 * Submit a single wiki contribution to the Worker.
 * Reads the Discord JWT from localStorage when available (best-effort).
 * Gracefully fails — callers should treat errors as non-blocking.
 */
export async function submitWikiContribution(params: {
  data: WikiContributionPayload
  activeThreadId: string | null
  prompt: string
}): Promise<WikiSubmitResult | WikiSubmitError> {
  try {
    const response = await fetch("/api/wiki/contribute", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contribution: {
          ...params.data,
          session_id: params.activeThreadId,
          source_excerpt: params.prompt,
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      console.warn("[OrdinalMind][WikiSubmit] Contribution failed", {
        at: new Date().toISOString(),
        field: params.data.field,
        slug: params.data.collection_slug,
        status: response.status,
        body: errorBody,
      })
      return {
        ok: false,
        error: errorBody || `http_${response.status}`,
      }
    }

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    console.info("[OrdinalMind][WikiSubmit] Contribution accepted", {
      at: new Date().toISOString(),
      field: params.data.field,
      slug: params.data.collection_slug,
      status: payload?.status,
      tier_applied: payload?.tier_applied,
    })
    return {
      ok: true,
      status: typeof payload?.status === "string" ? payload.status : undefined,
      tier_applied: typeof payload?.tier_applied === "string" ? payload.tier_applied : undefined,
      detail: typeof payload?.detail === "string" ? payload.detail : undefined,
    }
  } catch (error) {
    console.warn("[OrdinalMind][WikiSubmit] Request failed", {
      at: new Date().toISOString(),
      field: params.data.field,
      slug: params.data.collection_slug,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
