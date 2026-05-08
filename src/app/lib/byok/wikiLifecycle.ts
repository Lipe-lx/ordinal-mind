import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import type { Chronicle } from "../types"
import type { WikiHealth, WikiLifecycleStatus, WikiPage, WikiPageDraft } from "../wikiTypes"
import { KeyStore, type ByokConfig } from "./index"
import { generateWikiDraftWithByok } from "./wikiAdapter"
import { isSlugFlaggedForRegeneration, maybeRunWikiLint } from "../wikiLint"

const WIKI_STALE_MS = 7 * 24 * 60 * 60 * 1000

export interface WikiLifecycleState {
  wikiPage: WikiPage | null
  status: WikiLifecycleStatus
  statusLabel: string
  lastError: string | null
}

interface AuthMeResponse {
  ok?: boolean
  user?: {
    tier?: string
  }
}

export function useWikiLifecycle(chronicle: Chronicle | null): WikiLifecycleState {
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null)
  const [status, setStatus] = useState<WikiLifecycleStatus>("idle")
  const [lastError, setLastError] = useState<string | null>(null)
  const regenerateInFlightRef = useRef<string | null>(null)

  useEffect(() => {
    if (!chronicle) {
      let resetCancelled = false
      regenerateInFlightRef.current = null
      scheduleMicrotask(() => {
        if (resetCancelled) return
        setWikiPage(null)
        setStatus("idle")
        setLastError(null)
      })
      return () => {
        resetCancelled = true
      }
    }

    let cancelled = false
    const inscriptionId = chronicle.meta.inscription_id
    const slug = `inscription:${inscriptionId}`

    const run = async () => {
      setStatus("loading")
      setLastError(null)

      const health = await fetchWikiHealth()
      if (cancelled) return

      if (!isWikiHealthReady(health)) {
        setWikiPage(null)
        setStatus("not_initialized")
        setLastError(null)
        return
      }

      const fetched = await fetchWikiPage(slug)
      if (cancelled) return

      if (fetched.page) {
        setWikiPage(fetched.page)
        setStatus("loaded")
      } else if (fetched.error === "wiki_page_not_found") {
        setWikiPage(null)
        setStatus("missing")
      } else {
        setWikiPage(null)
        setStatus("unavailable")
      }

      const keyConfig = KeyStore.get()
      const canGenerate = Boolean(keyConfig?.key && keyConfig.provider !== "unknown")
      const canIngest = canGenerate ? await canCurrentUserIngestWiki() : false
      if (cancelled) return
      const canRegenerate = canGenerate && canIngest

      const shouldRefresh = shouldAttemptWikiRegeneration({
        health,
        canGenerate: canRegenerate,
        page: fetched.page,
        fetchError: fetched.error,
      })

      if (canRegenerate && shouldRefresh) {
        setStatus("refreshing")
        await regenerateWikiPage({
          chronicle,
          slug,
          config: keyConfig!,
          inFlightRef: regenerateInFlightRef,
          onSuccess: (page) => {
            if (cancelled) return
            setWikiPage(page)
            setStatus("loaded")
            setLastError(null)
          },
          onFailure: (message) => {
            if (cancelled) return
            setLastError(message)
            setStatus(fetched.page ? "loaded" : "unavailable")
          },
        })
      }

      scheduleIdle(async () => {
        if (!isWikiHealthReady(health)) return
        const report = await maybeRunWikiLint()
        if (cancelled) return

        if (!canRegenerate || !isSlugFlaggedForRegeneration(slug, report)) return
        if (regenerateInFlightRef.current === slug) return

        setStatus("refreshing")
        await regenerateWikiPage({
          chronicle,
          slug,
          config: keyConfig!,
          inFlightRef: regenerateInFlightRef,
          onSuccess: (page) => {
            if (cancelled) return
            setWikiPage(page)
            setStatus("loaded")
            setLastError(null)
          },
          onFailure: (message) => {
            if (cancelled) return
            setLastError(message)
            setStatus((current) => current === "loaded" ? "loaded" : "unavailable")
          },
        })
      })
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [chronicle])

  const statusLabel = useMemo(() => {
    switch (status) {
      case "loaded":
        return "Wiki loaded"
      case "refreshing":
        return "Wiki stale: refreshing"
      case "unavailable":
        return "Wiki unavailable"
      case "missing":
        return "Wiki page missing"
      case "not_initialized":
        return "Wiki not initialized"
      default:
        return ""
    }
  }, [status])

  return {
    wikiPage,
    status,
    statusLabel,
    lastError,
  }
}

interface RegenerateArgs {
  chronicle: Chronicle
  slug: string
  config: ByokConfig
  inFlightRef: MutableRefObject<string | null>
  onSuccess: (page: WikiPage) => void
  onFailure: (message: string) => void
}

async function regenerateWikiPage(args: RegenerateArgs): Promise<void> {
  const { chronicle, slug, config, inFlightRef, onSuccess, onFailure } = args
  if (inFlightRef.current === slug) return

  inFlightRef.current = slug
  try {
    const draft = await generateWikiDraftWithByok({
      chronicle,
      config,
      slug,
      entityType: "inscription",
    })

    if (!draft) {
      onFailure("wiki_draft_generation_failed")
      return
    }

    const ingested = await ingestWikiDraft(draft)
    if (!ingested.ok) {
      onFailure(ingested.error ?? "wiki_ingest_failed")
      return
    }

    const pageResult = await fetchWikiPage(slug)
    if (!pageResult.page) {
      onFailure("wiki_fetch_after_ingest_failed")
      return
    }

    onSuccess(pageResult.page)
  } catch (err) {
    onFailure(err instanceof Error ? err.message : "wiki_regeneration_failed")
  } finally {
    inFlightRef.current = null
  }
}

interface FetchWikiResult {
  page: WikiPage | null
  error: string | null
}

export async function fetchWikiHealth(): Promise<WikiHealth> {
  try {
    const response = await fetch("/api/wiki/health", { method: "GET" })
    const body = await response.json().catch(() => ({})) as Partial<WikiHealth>

    if (isWikiHealth(body)) {
      return body
    }

    return wikiHealthFallback("schema_missing")
  } catch {
    return wikiHealthFallback("db_unavailable")
  }
}

export async function fetchWikiPage(slug: string): Promise<FetchWikiResult> {
  try {
    const response = await fetch(`/api/wiki/${encodeURIComponent(slug)}`)
    const body = await response.json().catch(() => ({})) as Record<string, unknown>

    if (!response.ok) {
      return {
        page: null,
        error: typeof body.error === "string" ? body.error : "wiki_unavailable",
      }
    }

    return {
      page: body as unknown as WikiPage,
      error: null,
    }
  } catch {
    return { page: null, error: "wiki_unavailable" }
  }
}

export async function canCurrentUserIngestWiki(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "same-origin",
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => ({})) as AuthMeResponse
    if (!payload.ok) return false
    const tier = payload.user?.tier
    return tier === "og" || tier === "genesis"
  } catch {
    return false
  }
}

export function isWikiHealthReady(health: WikiHealth): boolean {
  return health.ready === true && health.status === "ready"
}

export function shouldAttemptWikiRegeneration(params: {
  health: WikiHealth
  canGenerate: boolean
  page: WikiPage | null
  fetchError: string | null
  now?: number
}): boolean {
  if (!params.canGenerate || !isWikiHealthReady(params.health)) return false
  if (params.page) return isWikiPageStale(params.page, params.now)
  return params.fetchError === "wiki_page_not_found"
}

export function isWikiPageStale(page: WikiPage, now = Date.now()): boolean {
  const source = page.updated_at || page.generated_at
  const ts = Date.parse(source)
  if (!Number.isFinite(ts)) return true
  return now - ts > WIKI_STALE_MS
}

async function ingestWikiDraft(draft: WikiPageDraft): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/wiki/ingest", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      const error = typeof payload.error === "string" ? payload.error : "unknown_error"
      logWikiLifecycleDiagnostic("warn", "wiki_ingest_failed", {
        slug: draft.slug,
        status: response.status,
        error,
      })
      return { ok: false, error }
    }

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    return payload.ok === true
      ? { ok: true }
      : { ok: false, error: "wiki_ingest_failed" }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown_error"
    logWikiLifecycleDiagnostic("warn", "wiki_ingest_request_failed", {
      slug: draft.slug,
      reason,
    })
    return { ok: false, error: "wiki_ingest_request_failed" }
  }
}

function scheduleIdle(callback: () => void): void {
  if (typeof window === "undefined") return
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => callback())
    return
  }
  window.setTimeout(callback, 50)
}

function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback)
    return
  }
  setTimeout(callback, 0)
}

function isWikiHealth(value: Partial<WikiHealth>): value is WikiHealth {
  return (
    typeof value.ready === "boolean"
    && (
      value.status === "ready"
      || value.status === "db_unavailable"
      || value.status === "schema_missing"
      || value.status === "schema_incomplete"
    )
    && Array.isArray(value.present_objects)
    && Array.isArray(value.missing_objects)
    && typeof value.checked_at === "string"
  )
}

function wikiHealthFallback(status: WikiHealth["status"]): WikiHealth {
  return {
    ok: status === "ready",
    ready: status === "ready",
    status,
    error: status === "ready" ? undefined : status === "db_unavailable" ? "wiki_db_unavailable" : `wiki_${status}`,
    phase: status === "ready" ? undefined : "fail_soft",
    present_objects: [],
    missing_objects: status === "ready" ? [] : ["raw_chronicle_events", "wiki_pages"],
    checked_at: new Date().toISOString(),
  }
}

function logWikiLifecycleDiagnostic(
  level: "info" | "warn",
  event: string,
  detail: Record<string, unknown>
): void {
  if (typeof console === "undefined") return
  const payload = {
    event,
    ...detail,
  }
  if (level === "warn") {
    console.warn("[OrdinalMind][WikiLifecycle]", payload)
    return
  }
  console.info("[OrdinalMind][WikiLifecycle]", payload)
}
