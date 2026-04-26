// X mentions discovery via search-engine indexing.
// Best-effort only: X content may be filtered by X itself and may not be indexed by third-party search engines.

export interface XMention {
  url: string
  title: string
  snippet: string
  found_at: string // ISO timestamp of when the scrape happened
}

export interface XMentionSearchOptions {
  inscriptionNumber?: number
  collectionName?: string
  itemName?: string
  officialXUrls?: string[]
  diagnostics?: XMentionDiagnostics
  debug?: boolean
  requestId?: string
  queryDelayMs?: number
}

export interface XMentionDiagnostics {
  collection_name?: string
  item_name?: string
  official_x_urls: string[]
  candidate_handles: string[]
  queries: string[]
  attempts: Array<{
    provider: SearchProvider
    transport: string
    query: string
    outcome: "query_completed" | "non_ok" | "fetch_failed" | "transport_unavailable"
    status?: number
    mention_count?: number
  }>
}

type SearchProvider = "ddg" | "bing"

const BRAVE_SEARCH_URL = "https://search.brave.com/search"
const DEFAULT_QUERY_DELAY_MS = 2500
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 2
const MAX_MENTIONS = 8

export async function scrapeXMentions(
  inscriptionId: string,
  options: XMentionSearchOptions = {}
): Promise<XMention[]> {
  const queries = buildXMentionQueries(inscriptionId, options.inscriptionNumber, {
    collectionName: options.collectionName,
    itemName: options.itemName,
    officialXUrls: options.officialXUrls,
  })
  if (options.diagnostics) {
    options.diagnostics.collection_name = options.collectionName
    options.diagnostics.item_name = options.itemName
    options.diagnostics.official_x_urls = [...(options.officialXUrls ?? [])]
    options.diagnostics.candidate_handles = buildHandleCandidates({
      officialXUrls: options.officialXUrls,
      collectionName: options.collectionName,
    })
    options.diagnostics.queries = [...queries]
  }

  debugLog(options, "brave_search_start", { query_count: queries.length })
  return searchBrave(queries, options)
}

export function buildXMentionQueries(
  inscriptionId: string,
  inscriptionNumber?: number,
  context: Pick<XMentionSearchOptions, "collectionName" | "itemName" | "officialXUrls"> = {}
): string[] {
  const itemName = normalizeSearchPhrase(context.itemName)
  const collectionName = normalizeSearchPhrase(context.collectionName)
  const handleCandidates = buildHandleCandidates({
    officialXUrls: context.officialXUrls,
    collectionName,
  }).slice(0, 2)

  const candidates = [
    itemName && collectionName ? `site:x.com/status "${itemName}" "${collectionName}"` : null,
    itemName ? `site:x.com/status "${itemName}"` : null,
    collectionName ? `site:x.com/status "${collectionName}"` : null,
    handleCandidates[0] && collectionName ? `site:x.com/${handleCandidates[0]}/status "${collectionName}"` : null,
  ]

  return candidates.filter((query, index, arr): query is string =>
    Boolean(query) && arr.indexOf(query) === index
  )
}

function buildHandleCandidates(args: {
  officialXUrls?: string[]
  collectionName?: string
}): string[] {
  const officialHandles = (args.officialXUrls ?? [])
    .map(extractHandleFromXUrl)
    .filter((handle): handle is string => Boolean(handle))

  const normalizedName = normalizeHandleCandidate(args.collectionName)
  const tokenHandles = (args.collectionName ?? "")
    .split(/[^A-Za-z0-9]+/g)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 5 && !GENERIC_HANDLE_TOKENS.has(token))

  return [...new Set([
    ...officialHandles,
    normalizedName,
    ...tokenHandles,
  ].filter((value): value is string => Boolean(value)))]
}

function normalizeSearchPhrase(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 1 ? normalized : undefined
}

function normalizeHandleCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  return normalized.length >= 5 ? normalized : undefined
}

const GENERIC_HANDLE_TOKENS = new Set([
  "bitcoin",
  "ordinals",
  "ordinal",
  "collection",
  "official",
])

function extractHandleFromXUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase()
    if (hostname !== "x.com" && hostname !== "twitter.com") return null
    const handle = url.pathname.split("/").filter(Boolean)[0]
    return handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null
  } catch {
    return null
  }
}

async function searchBrave(
  queries: string[],
  options: XMentionSearchOptions
): Promise<XMention[]> {
  const allMentions: XMention[] = []
  let consecutiveFailures = 0

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    const result = await scrapeBrave(query, options)
    allMentions.push(...result.mentions)

    if (result.unavailable) {
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
        recordAttempt(options, {
          provider: "ddg", // Keeping 'ddg' in diagnostics type to avoid changing types.ts right now
          transport: "GET",
          query,
          outcome: "transport_unavailable",
        })
        debugLog(options, "brave_transport_unavailable", {
          query,
          consecutive_failures: consecutiveFailures,
        })
        break
      }
      if (i < queries.length - 1) {
        await sleep(options.queryDelayMs ?? DEFAULT_QUERY_DELAY_MS)
      }
      continue
    } else {
      consecutiveFailures = 0
    }

    if (i < queries.length - 1) {
      await sleep(options.queryDelayMs ?? DEFAULT_QUERY_DELAY_MS)
    }

    if (allMentions.length >= MAX_MENTIONS) break
  }

  return dedupeXMentions(allMentions).slice(0, MAX_MENTIONS)
}

async function scrapeBrave(
  query: string,
  options: XMentionSearchOptions
): Promise<{ mentions: XMention[]; unavailable: boolean }> {
  const foundAt = new Date().toISOString()

  let res: Response
  try {
    res = await fetch(`${BRAVE_SEARCH_URL}?${new URLSearchParams({ q: query }).toString()}`, {
      headers: searchHeaders(),
      signal: AbortSignal.timeout(3500),
    })
  } catch {
    recordAttempt(options, {
      provider: "ddg",
      transport: "GET",
      query,
      outcome: "fetch_failed",
    })
    debugLog(options, "brave_fetch_failed", { query })
    return { mentions: [], unavailable: true }
  }

  if (!res.ok) {
    recordAttempt(options, {
      provider: "ddg",
      transport: "GET",
      query,
      outcome: "non_ok",
      status: res.status,
    })
    debugLog(options, "brave_non_ok", {
      query,
      status: res.status,
    })
    return { mentions: [], unavailable: true }
  }

  const html = await res.text()
  const mentions = parseBraveResults(html, foundAt)
  recordAttempt(options, {
    provider: "ddg",
    transport: "GET",
    query,
    outcome: "query_completed",
    mention_count: mentions.length,
  })
  debugLog(options, "brave_query_completed", {
    query,
    mention_count: mentions.length,
  })
  return { mentions, unavailable: false }
}

export function parseBraveResults(html: string, foundAt: string): XMention[] {
  const mentions: XMention[] = []
  // Brave Search results typically have <div class="snippet..."><a href="...">...</div>
  const resultPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(resultPattern)) {
    const href = decodeHtmlEntities(match[1] ?? "")
    const realUrl = normalizeXMentionUrl(href) ?? normalizePublicXReferenceUrl(href)
    if (!realUrl) continue

    const title = cleanHtmlText(match[2] ?? "")
    // Snippet extraction might be harder without full DOM parsing, 
    // but we can extract surrounding text or just rely on title for mentions.
    const snippet = title 

    mentions.push({
      url: realUrl,
      title,
      snippet,
      found_at: foundAt,
    })
  }

  return dedupeXMentions(mentions)
}

export function normalizeXMentionUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase()
    if (hostname !== "x.com" && hostname !== "twitter.com") return null

    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length < 3 || parts[1] !== "status" || !/^\d+$/.test(parts[2])) {
      return null
    }

    const normalized = new URL(`https://x.com/${parts[0]}/status/${parts[2]}`)
    return normalized.toString()
  } catch {
    return null
  }
}

function normalizePublicXReferenceUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase()
    if (hostname !== "twstalker.com" && !hostname.endsWith(".twstalker.com")) return null

    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length === 0) return null

    url.hash = ""
    url.search = ""
    return url.toString()
  } catch {
    return null
  }
}

function dedupeXMentions(mentions: XMention[]): XMention[] {
  const seen = new Set<string>()
  return mentions.filter((mention) => {
    const normalizedUrl = normalizeXMentionUrl(mention.url) ?? normalizePublicXReferenceUrl(mention.url)
    if (!normalizedUrl || seen.has(normalizedUrl)) return false
    seen.add(normalizedUrl)
    mention.url = normalizedUrl
    mention.title = collapseWhitespace(mention.title)
    mention.snippet = collapseWhitespace(mention.snippet)
    return true
  })
}

function cleanHtmlText(value: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
  )
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function searchHeaders(contentType?: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://search.brave.com/",
    ...(contentType ? { "Content-Type": contentType } : {}),
  }
}

function debugLog(options: XMentionSearchOptions, event: string, data: Record<string, unknown>): void {
  if (!options.debug) return
  console.info(`[XMentionsDiag] ${JSON.stringify({
    at: new Date().toISOString(),
    request_id: options.requestId ?? null,
    event,
    ...data,
  })}`)
}

function recordAttempt(
  options: XMentionSearchOptions,
  attempt: XMentionDiagnostics["attempts"][number]
): void {
  options.diagnostics?.attempts.push(attempt)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
