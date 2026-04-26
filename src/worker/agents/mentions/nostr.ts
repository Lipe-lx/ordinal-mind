import type { SocialMention, SourceCatalogItem } from "../../../app/lib/types"
import type { MentionProviderContext, MentionProviderResult } from "./types"
import { recordAttempt } from "./types"

const DEFAULT_NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
  "wss://purplepag.es",
] as const

type RelayMode = "search" | "recent_scan"

interface RelayProbeResult {
  relay: string
  supportsSearch: boolean
  probeStatus: "ok" | "unsupported" | "unavailable"
}

interface NostrSearchDependencies {
  fetchImpl?: typeof fetch
  webSocketFactory?: (url: string) => WebSocket
}

export async function searchNostr(
  context: MentionProviderContext,
  deps: NostrSearchDependencies = {}
): Promise<MentionProviderResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const webSocketFactory = deps.webSocketFactory ?? ((url: string) => new WebSocket(url))
  const relays = normalizeRelays(context.nostrRelays)
  const probes = await Promise.all(relays.map((relay) => probeRelay(relay, context, fetchImpl)))

  const tasks = probes.flatMap((probe) =>
    context.queries.map((query) => () => searchRelayQueryWithFallback(probe, query, context, webSocketFactory))
  )
  const results = await runWithConcurrency(tasks, 2)
  const mentions = dedupeMentions(results.flat())
  const sourceCatalog: SourceCatalogItem[] = [{
    source_type: "nostr_nip50_search",
    url_or_ref: probes.map((probe) => probe.relay).join(", "),
    trust_level: "public_social",
    fetched_at: new Date().toISOString(),
    partial: probes.some((probe) => probe.probeStatus === "unavailable"),
    detail: summarizeRelayCoverage(probes, mentions.length),
  }]

  return { mentions, sourceCatalog }
}

async function probeRelay(
  relay: string,
  context: MentionProviderContext,
  fetchImpl: typeof fetch
): Promise<RelayProbeResult> {
  const infoUrl = relay.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:")
  let res: Response
  try {
    res = await fetchImpl(infoUrl, {
      headers: {
        "Accept": "application/nostr+json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(5000),
    })
  } catch (error) {
    recordAttempt(context.diagnostics, {
      target: relay,
      query: "NIP-11 probe",
      outcome: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    })
    return { relay, supportsSearch: false, probeStatus: "unavailable" }
  }

  if (!res.ok) {
    recordAttempt(context.diagnostics, {
      target: relay,
      query: "NIP-11 probe",
      outcome: "non_ok",
      status: res.status,
    })
    return { relay, supportsSearch: false, probeStatus: "unavailable" }
  }

  try {
    const payload = await res.json() as Record<string, unknown>
    const supportsSearch = Array.isArray(payload.supported_nips)
      ? payload.supported_nips.some((nip) => nip === 50)
      : false
    if (!supportsSearch) {
      recordAttempt(context.diagnostics, {
        target: relay,
        query: "NIP-11 probe",
        outcome: "unsupported",
        detail: "Relay does not advertise NIP-50; using recent-scan fallback.",
      })
    }
    return {
      relay,
      supportsSearch,
      probeStatus: supportsSearch ? "ok" : "unsupported",
    }
  } catch (error) {
    recordAttempt(context.diagnostics, {
      target: relay,
      query: "NIP-11 probe",
      outcome: "fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    })
    return { relay, supportsSearch: false, probeStatus: "unavailable" }
  }
}

async function searchRelayQueryWithFallback(
  probe: RelayProbeResult,
  query: MentionProviderContext["queries"][number],
  context: MentionProviderContext,
  webSocketFactory: (url: string) => WebSocket
): Promise<SocialMention[]> {
  if (probe.supportsSearch) {
    const searchResults = await searchRelayQuery(
      probe.relay,
      query,
      context,
      webSocketFactory,
      "search"
    )
    if (searchResults.length > 0) return searchResults
    context.diagnostics?.notes.push(`${probe.relay}: NIP-50 returned 0 results, switching to recent-scan fallback.`)
  }

  return searchRelayQuery(
    probe.relay,
    query,
    context,
    webSocketFactory,
    "recent_scan"
  )
}

async function searchRelayQuery(
  relay: string,
  query: MentionProviderContext["queries"][number],
  context: MentionProviderContext,
  webSocketFactory: (url: string) => WebSocket,
  mode: RelayMode
): Promise<SocialMention[]> {
  const timeoutMs = 3800
  const results: SocialMention[] = []
  const discoveredAt = new Date().toISOString()
  const sinceDays = mode === "search" ? 30 : 7
  const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000)
  const subscriptionId = `om_${Math.random().toString(36).slice(2, 10)}`
  const limit = mode === "search"
    ? query.limit
    : Math.max(40, query.limit * 14)

  return await new Promise<SocialMention[]>((resolve) => {
    let settled = false
    let socket: WebSocket | null = null
    const finalize = (
      outcome: "query_completed" | "timeout" | "transport_unavailable",
      detail?: string
    ) => {
      if (settled) return
      settled = true
      recordAttempt(context.diagnostics, {
        target: relay,
        query: query.text,
        outcome,
        result_count: results.length,
        detail: detail ?? mode,
      })
      try {
        socket?.close()
      } catch {
        // ignore close errors
      }
      resolve(results)
    }

    const timer = setTimeout(() => finalize("timeout", `${mode}: timed out waiting for relay response`), timeoutMs)

    try {
      socket = webSocketFactory(relay)
    } catch (error) {
      clearTimeout(timer)
      recordAttempt(context.diagnostics, {
        target: relay,
        query: query.text,
        outcome: "transport_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      })
      resolve([])
      return
    }

    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify([
        "REQ",
        subscriptionId,
        mode === "search"
          ? {
              kinds: [1],
              search: query.text,
              limit,
              since,
            }
          : {
              kinds: [1],
              limit,
              since,
            },
      ]))
    })

    socket.addEventListener("message", (event) => {
      let payload: unknown
      try {
        payload = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!Array.isArray(payload) || payload.length < 2) return
      const messageType = payload[0]

      if (messageType === "EVENT" && payload[1] === subscriptionId && payload[2] && typeof payload[2] === "object") {
        const normalized = normalizeNostrEvent(
          payload[2] as Record<string, unknown>,
          query,
          discoveredAt,
          mode
        )
        if (!normalized) return
        if (mode === "recent_scan" && !queryMatchesContent(normalized.text, query.text)) {
          return
        }
        results.push(normalized)
      }

      if (messageType === "EOSE" && payload[1] === subscriptionId) {
        clearTimeout(timer)
        finalize("query_completed")
      }

      if (messageType === "NOTICE") {
        context.diagnostics?.notes.push(`${relay}: ${String(payload[1] ?? "")}`)
      }
    })

    socket.addEventListener("error", () => {
      clearTimeout(timer)
      finalize("transport_unavailable", `${mode}: relay socket errored`)
    })

    socket.addEventListener("close", () => {
      clearTimeout(timer)
      finalize(results.length > 0 ? "query_completed" : "transport_unavailable", `${mode}: relay closed`)
    })
  })
}

function normalizeNostrEvent(
  event: Record<string, unknown>,
  query: MentionProviderContext["queries"][number],
  discoveredAt: string,
  mode: RelayMode
): SocialMention | null {
  const id = typeof event.id === "string" ? event.id : undefined
  const content = typeof event.content === "string" ? event.content.trim() : ""
  if (!id || !content) return null

  const tags = Array.isArray(event.tags) ? event.tags : []
  const nip05 = findTag(tags, "nip05")
  const createdAt = typeof event.created_at === "number"
    ? new Date(event.created_at * 1000).toISOString()
    : discoveredAt

  return {
    platform: "nostr",
    provider: "nostr",
    canonical_url: `https://njump.me/${id}`,
    title: content.slice(0, 100),
    excerpt: content.slice(0, 240),
    text: content,
    author_handle: nip05 ?? abbreviatePubkey(typeof event.pubkey === "string" ? event.pubkey : undefined),
    author_url: typeof event.pubkey === "string" ? `https://njump.me/${event.pubkey}` : undefined,
    published_at: createdAt,
    discovered_at: discoveredAt,
    scope: query.scope,
    match_type: query.matchType,
    provider_confidence: mode === "search"
      ? query.matchWeight
      : Math.max(0.35, query.matchWeight * 0.8),
    engagement: {
      quotes: tags.filter((tag) => Array.isArray(tag) && tag[0] === "q").length,
    },
  }
}

function queryMatchesContent(content: string, query: string): boolean {
  const normalizedContent = content.toLowerCase()
  const tokens = query
    .toLowerCase()
    .replace(/"/g, "")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 || /^\d+$/.test(token))

  if (tokens.length === 0) return true
  const matches = tokens.filter((token) => normalizedContent.includes(token))
  if (tokens.length <= 2) {
    return matches.length === tokens.length
  }
  if (tokens.length <= 4) {
    return matches.length >= 2
  }
  return matches.length >= 3
}

function findTag(tags: unknown[], key: string): string | undefined {
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === key && typeof tag[1] === "string") {
      return tag[1]
    }
  }
  return undefined
}

function abbreviatePubkey(pubkey: string | undefined): string | undefined {
  if (!pubkey) return undefined
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

function normalizeRelays(relays: string[] | undefined): string[] {
  const defaults = [...DEFAULT_NOSTR_RELAYS]
  const provided = (relays ?? []).map((relay) => relay.trim()).filter(Boolean)
  return [...new Set(provided.length > 0 ? provided : defaults)]
}

function summarizeRelayCoverage(probes: RelayProbeResult[], mentionCount: number): string {
  const withSearch = probes.filter((probe) => probe.supportsSearch).length
  const fallbackOnly = probes.filter((probe) => !probe.supportsSearch && probe.probeStatus !== "unavailable").length
  const unavailable = probes.filter((probe) => probe.probeStatus === "unavailable").length
  return [
    `${mentionCount} mention${mentionCount === 1 ? "" : "s"} found`,
    `${withSearch} relay${withSearch === 1 ? "" : "s"} with NIP-50`,
    `${fallbackOnly} relay${fallbackOnly === 1 ? "" : "s"} using recent-scan`,
    unavailable > 0 ? `${unavailable} relay${unavailable === 1 ? "" : "s"} unavailable` : null,
  ].filter(Boolean).join(" · ")
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const current = cursor
      cursor += 1
      results[current] = await tasks[current]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()))
  return results
}

function dedupeMentions(mentions: SocialMention[]): SocialMention[] {
  const seen = new Set<string>()
  return mentions.filter((mention) => {
    const key = mention.canonical_url
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
