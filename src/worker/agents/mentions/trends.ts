import type { SocialMention, SourceCatalogItem } from "../../../app/lib/types"
import type { MentionProviderContext, MentionProviderResult } from "./types"
import { recordAttempt } from "./types"

export async function fetchGoogleTrendsMacro(
  context: MentionProviderContext,
  fetchImpl: typeof fetch = fetch
): Promise<MentionProviderResult> {
  const query = context.collectionName ?? context.fullLabel ?? context.itemName ?? context.inscriptionId
  if (!query) {
    recordAttempt(context.diagnostics, {
      query: "unknown",
      outcome: "skipped",
      detail: "No collection or inscription query available for Google Trends lookup.",
    })
    return {
      mentions: [],
      sourceCatalog: [{
        source_type: "google_trends_macro_attention",
        url_or_ref: "https://trends.google.com/trending",
        trust_level: "public_social",
        fetched_at: new Date().toISOString(),
        partial: true,
        detail: "Skipped Trends lookup because no query term was available.",
      }],
    }
  }

  const result = await fetchInterestScore(query, fetchImpl)
  if (!result.ok) {
    recordAttempt(context.diagnostics, {
      query,
      outcome: result.reason === "http_non_ok" ? "non_ok" : "fetch_failed",
      status: result.status,
      detail: result.detail,
    })
    context.diagnostics?.notes.push(`Google Trends unavailable for "${query}": ${result.detail}`)
    return {
      mentions: [],
      sourceCatalog: [{
        source_type: "google_trends_macro_attention",
        url_or_ref: "https://trends.google.com/trending",
        trust_level: "public_social",
        fetched_at: new Date().toISOString(),
        partial: true,
        detail: `Lookup failed for "${query}" (${result.detail}).`,
      }],
    }
  }

  const nowIso = new Date().toISOString()
  const mention: SocialMention = {
    platform: "google_trends",
    provider: "google_trends",
    canonical_url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
    title: `Google search interest for "${query}"`,
    excerpt: `Annual attention summary: ${result.score1y}/100`,
    text: `Google Trends macro attention for ${query} over time:\n- Last 7 Days: ${result.score7d}/100\n- Last 30 Days: ${result.score30d}/100\n- Last 90 Days: ${result.score90d}/100\n- 1 Year: ${result.score1y}/100`,
    published_at: nowIso,
    discovered_at: nowIso,
    scope: "collection_level",
    match_type: "collection_only",
    provider_confidence: Math.max(0.1, Math.min(1, result.score1y / 100)),
  }

  recordAttempt(context.diagnostics, {
    query,
    outcome: "query_completed",
    result_count: 1,
    detail: `Attention scores (7d: ${result.score7d}, 30d: ${result.score30d}, 90d: ${result.score90d}, 1y: ${result.score1y})`,
  })

  const sourceCatalog: SourceCatalogItem[] = [{
    source_type: "google_trends_macro_attention",
    url_or_ref: mention.canonical_url,
    trust_level: "public_social",
    fetched_at: new Date().toISOString(),
    partial: false,
    detail: `Macro attention scores (7d: ${result.score7d}, 30d: ${result.score30d}, 90d: ${result.score90d}, 1y: ${result.score1y}) for "${query}".`,
  }]

  return { mentions: [mention], sourceCatalog }
}

async function fetchInterestScore(
  query: string,
  fetchImpl: typeof fetch
): Promise<
  | { ok: true; score7d: number; score30d: number; score90d: number; score1y: number }
  | { ok: false; reason: "http_non_ok" | "fetch_failed"; status?: number; detail: string }
> {
  const exploreReq = {
    comparisonItem: [{ keyword: query, geo: "", time: "today 12-m" }],
    category: 0,
    property: "",
  }

  let cookieHeader = ""
  try {
    const homeRes = await fetchImpl("https://trends.google.com/trends/", {
      headers: trendsHeaders(),
      signal: AbortSignal.timeout(5000),
    })
    const setCookie = homeRes.headers.get("set-cookie")
    if (setCookie) {
      const nidMatch = setCookie.match(/NID=[^;]+/)
      if (nidMatch) {
        cookieHeader = nidMatch[0]
      }
    }
  } catch {
    // best effort
  }

  let exploreRes: Response
  try {
    const url = new URL("https://trends.google.com/trends/api/explore")
    url.searchParams.set("hl", "en-US")
    url.searchParams.set("tz", "0")
    url.searchParams.set("req", JSON.stringify(exploreReq))
    exploreRes = await fetchImpl(url.toString(), {
      headers: {
        ...trendsHeaders(),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(7000),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  if (!exploreRes.ok) {
    return {
      ok: false,
      reason: "http_non_ok",
      status: exploreRes.status,
      detail: `explore endpoint returned HTTP ${exploreRes.status}`,
    }
  }

  let explorePayload: Record<string, unknown>
  try {
    explorePayload = parseXssiJson(await exploreRes.text())
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const widgets = Array.isArray(explorePayload.widgets) ? explorePayload.widgets : []
  const timeseriesWidget = widgets.find((widget) => {
    if (!widget || typeof widget !== "object") return false
    const id = (widget as Record<string, unknown>).id
    return typeof id === "string" && id.toUpperCase().includes("TIMESERIES")
  }) as Record<string, unknown> | undefined

  if (!timeseriesWidget) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: "explore response had no timeseries widget",
    }
  }

  const token = typeof timeseriesWidget.token === "string" ? timeseriesWidget.token : null
  const request = timeseriesWidget.request
  if (!token || !request || typeof request !== "object") {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: "timeseries widget did not expose token/request",
    }
  }

  let timelineRes: Response
  try {
    const url = new URL("https://trends.google.com/trends/api/widgetdata/multiline")
    url.searchParams.set("hl", "en-US")
    url.searchParams.set("tz", "0")
    url.searchParams.set("req", JSON.stringify(request))
    url.searchParams.set("token", token)
    timelineRes = await fetchImpl(url.toString(), {
      headers: {
        ...trendsHeaders(),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(7000),
    })
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  if (!timelineRes.ok) {
    return {
      ok: false,
      reason: "http_non_ok",
      status: timelineRes.status,
      detail: `timeline endpoint returned HTTP ${timelineRes.status}`,
    }
  }

  let timelinePayload: Record<string, unknown>
  try {
    timelinePayload = parseXssiJson(await timelineRes.text())
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const defaultObj = asRecord(timelinePayload.default)
  const timelineData = defaultObj && Array.isArray(defaultObj.timelineData)
    ? defaultObj.timelineData
    : []
  const points = timelineData
    .map((point) => {
      const values = asRecord(point as Record<string, unknown>)?.value
      if (!Array.isArray(values) || values.length === 0) return null
      const score = typeof values[0] === "number" ? values[0] : Number(values[0])
      return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null
    })
    .filter((value): value is number => value !== null)

  if (points.length === 0) {
    return { ok: true, score7d: 0, score30d: 0, score90d: 0, score1y: 0 }
  }

  // today 12-m returns roughly 52 data points (weekly)
  const calcAverage = (arr: number[], count: number) => {
    const window = arr.slice(-Math.min(arr.length, Math.max(1, count)))
    if (window.length === 0) return 0
    return Math.round(window.reduce((sum, value) => sum + value, 0) / window.length)
  }

  const score7d = calcAverage(points, 1) // last 1 week
  const score30d = calcAverage(points, 4) // last 4 weeks (~1 month)
  const score90d = calcAverage(points, 13) // last 13 weeks (~3 months)
  const score1y = calcAverage(points, points.length) // all points (up to 52)

  return { ok: true, score7d, score30d, score90d, score1y }
}

function parseXssiJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^\)\]\}',?\n?/, "").trim()
  const parsed = JSON.parse(cleaned) as unknown
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Trends JSON payload.")
  }
  return parsed as Record<string, unknown>
}

function trendsHeaders(): Record<string, string> {
  return {
    "Accept": "application/json,text/plain,*/*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://trends.google.com/trending",
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}
