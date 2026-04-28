import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import type { Chronicle } from "../types"
import type { WikiLifecycleStatus, WikiPage, WikiPageDraft } from "../wikiTypes"
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

export function useWikiLifecycle(chronicle: Chronicle | null): WikiLifecycleState {
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null)
  const [status, setStatus] = useState<WikiLifecycleStatus>("idle")
  const [lastError, setLastError] = useState<string | null>(null)
  const regenerateInFlightRef = useRef<string | null>(null)

  useEffect(() => {
    if (!chronicle) {
      setWikiPage(null)
      setStatus("idle")
      setLastError(null)
      regenerateInFlightRef.current = null
      return
    }

    let cancelled = false
    const inscriptionId = chronicle.meta.inscription_id
    const slug = `inscription:${inscriptionId}`

    const run = async () => {
      setStatus("loading")
      setLastError(null)

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

      const shouldRefresh = fetched.page
        ? isWikiPageStale(fetched.page)
        : fetched.error === "wiki_page_not_found"

      if (canGenerate && shouldRefresh) {
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
        const report = await maybeRunWikiLint()
        if (cancelled) return

        if (!canGenerate || !isSlugFlaggedForRegeneration(slug, report)) return
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
      case "missing":
        return "Wiki unavailable"
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
    if (!ingested) {
      onFailure("wiki_ingest_failed")
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

export function isWikiPageStale(page: WikiPage, now = Date.now()): boolean {
  const source = page.updated_at || page.generated_at
  const ts = Date.parse(source)
  if (!Number.isFinite(ts)) return true
  return now - ts > WIKI_STALE_MS
}

async function ingestWikiDraft(draft: WikiPageDraft): Promise<boolean> {
  try {
    const response = await fetch("/api/wiki/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    if (!response.ok) return false

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    return payload.ok === true
  } catch {
    return false
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
