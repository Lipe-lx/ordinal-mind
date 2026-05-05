import { braveProvider } from "./searchProviders/brave"
import { exaProvider } from "./searchProviders/exa"
import { perplexityProvider } from "./searchProviders/perplexity"
import { coingeckoProvider } from "./searchProviders/coingecko"
import { serpapiProvider } from "./searchProviders/serpapi"
import { serpapiSearchProvider } from "./searchProviders/serpapiSearch"
import type { SearchToolResult, SearchProviderConfig } from "./searchProviders/types"
import { executeWikiTool } from "./wikiAdapter"

const PROVIDERS = {
  web_search: braveProvider,
  deep_research: exaProvider,
  synthesized_search: perplexityProvider,
  market_context: coingeckoProvider,
  public_interest: serpapiProvider,
}

const WIKI_TOOL_NAMES = new Set([
  "search_wiki",
  "get_raw_events",
  "get_timeline",
  "get_collection_context",
])

export interface ResearchLog {
  id: string
  tool: string
  args: Record<string, unknown>
  status: "running" | "done" | "partial" | "error"
  result?: string
  error?: string
}

export interface ResearchKeys {
  braveSearchApiKey?: string
  exaApiKey?: string
  perplexityApiKey?: string
  serpapiApiKey?: string
}

export class ToolExecutor {
  private callCount = 0
  private maxCalls = 12
  private keys: ResearchKeys
  private onLog?: (log: ResearchLog) => void
  private resultCache = new Map<string, SearchToolResult>()
  private cacheEntries: Array<{ toolName: string; args: Record<string, unknown>; result: SearchToolResult }> = []

  constructor(keys: ResearchKeys, onLog?: (log: ResearchLog) => void) {
    this.keys = keys
    this.onLog = onLog
  }

  public getKeys(): ResearchKeys {
    return this.keys
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<SearchToolResult> {
    const id = Math.random().toString(36).substring(2, 9)
    const sanitizedArgs = sanitizeArguments(args)
    const cacheKey = buildToolCacheKey(toolName, sanitizedArgs)
    const exactCached = this.resultCache.get(cacheKey)

    if (exactCached) {
      const cachedResult = cloneToolResult(exactCached)
      this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: cachedResult.partial ? "partial" : "done", result: `${cachedResult.summary ?? toolName} (cache hit)` })
      return cachedResult
    }

    const reusedResult = this.tryReuseToolResult(toolName, sanitizedArgs)
    if (reusedResult) {
      this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: reusedResult.partial ? "partial" : "done", result: `${reusedResult.summary ?? toolName} (reused)` })
      return reusedResult
    }
    
    if (this.callCount >= this.maxCalls) {
      const error = "Maximum tool call limit reached."
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }
    
    this.callCount++
    console.log(`[ToolExecutor] Executing ${toolName} (Call ${this.callCount}/${this.maxCalls})`, sanitizedArgs)
    this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: "running" })

    if (WIKI_TOOL_NAMES.has(toolName)) {
      try {
        const payload = await executeWikiTool(toolName, sanitizedArgs)
        const error = typeof payload.error === "string" ? payload.error : undefined
        const partial = payload.partial === true
        const summary = error
          ? partial
            ? `wiki partial: ${error}`
            : `wiki error: ${error}`
          : `wiki ok: ${toolName}`
        this.onLog?.({
          id,
          tool: toolName,
          args,
          status: error ? (partial ? "partial" : "error") : "done",
          result: summary,
          error,
        })
        const result = {
          tool_name: toolName,
          results: [{ content: summary }],
          summary,
          facts: extractWikiFacts(toolName, payload),
          data: payload,
          partial,
          error,
        }
        this.storeToolResult(cacheKey, toolName, sanitizedArgs, result)
        return cloneToolResult(result)
      } catch (e) {
        const error = String(e)
        this.onLog?.({ id, tool: toolName, args, status: "error", error })
        return { tool_name: toolName, results: [], summary: error, error, partial: false }
      }
    }

    let provider = Object.values(PROVIDERS).find(p => p.name === toolName)
    
    // Fallback logic for web_search
    if (toolName === "web_search" && !this.keys.braveSearchApiKey && this.keys.serpapiApiKey) {
      provider = serpapiSearchProvider
    }

    if (!provider) {
      // If no client-side provider matches (likely because of missing keys), 
      // try to use the Worker-based resilient fallback tools.
      if (toolName === "web_search" || toolName === "deep_research") {
        try {
          const payload = (await executeWikiTool(toolName, sanitizedArgs)) as {
            ok: boolean;
            results?: Array<{ title: string; url: string; content?: string; snippet?: string }>;
          }
          if (payload.ok) {
            const summary = `resilient search ok: ${toolName}`
            const result = {
              tool_name: toolName,
              results: (payload.results || []).map((r) => ({
                title: r.title,
                url: r.url,
                content: r.content || r.snippet || ""
              })),
              summary,
              data: payload as Record<string, unknown>,
              partial: false,
            }
            this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: "done", result: summary })
            this.storeToolResult(cacheKey, toolName, sanitizedArgs, result)
            return cloneToolResult(result)
          }
        } catch {
          // Fall through to error
        }
      }

      const error = `Unknown tool or missing API key: ${toolName}`
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }

    const config = this.getConfigForTool(toolName)
    try {
      const result = await provider.execute(sanitizedArgs, config)
      const summary = result.summary
        ?? result.results.map(r => r.title || (r.content ? `${r.content.substring(0, 50)}...` : "No content")).join(", ")
      
      if (result.error) {
        this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: result.partial ? "partial" : "error", error: result.error, result: summary })
      } else {
        this.onLog?.({ id, tool: toolName, args: sanitizedArgs, status: result.partial ? "partial" : "done", result: summary })
      }
      
      const normalizedResult = {
        ...result,
        summary,
        partial: result.partial ?? false,
      }
      this.storeToolResult(cacheKey, toolName, sanitizedArgs, normalizedResult)
      return cloneToolResult(normalizedResult)
    } catch (e) {
      const error = String(e)
      console.error(`[ToolExecutor] Error executing ${toolName}:`, e)
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }
  }

  private storeToolResult(
    cacheKey: string,
    toolName: string,
    args: Record<string, unknown>,
    result: SearchToolResult
  ): void {
    const cached = cloneToolResult(result)
    this.resultCache.set(cacheKey, cached)
    this.cacheEntries.push({ toolName, args: { ...args }, result: cached })
  }

  private tryReuseToolResult(toolName: string, args: Record<string, unknown>): SearchToolResult | null {
    if (toolName !== "get_raw_events") return null

    const inscriptionId = typeof args.inscription_id === "string" ? args.inscription_id : ""
    if (!inscriptionId) return null

    const requestedEventTypes = normalizeEventTypes(args.event_types)
    const requestedLimit = normalizeLimit(args.limit, 50)

    for (const entry of this.cacheEntries) {
      if (entry.toolName !== "get_raw_events") continue
      if (entry.args.inscription_id !== inscriptionId) continue

      const payload = entry.result.data
      const cachedEvents = Array.isArray(payload?.events) ? payload.events : null
      if (!cachedEvents) continue

      const cachedEventTypes = normalizeEventTypes(entry.args.event_types)
      const cachedLimit = normalizeLimit(entry.args.limit, 50)
      const cachedCount = typeof payload?.event_count === "number" ? payload.event_count : cachedEvents.length
      const cachedIsComplete = cachedCount < cachedLimit

      if (!canReuseRawEvents(requestedEventTypes, cachedEventTypes, cachedIsComplete)) continue

      const filteredEvents = filterRawEventsByType(cachedEvents, requestedEventTypes).slice(0, requestedLimit)
      const filteredPayload = {
        ...(payload ?? {}),
        inscription_id: inscriptionId,
        event_count: filteredEvents.length,
        events: filteredEvents,
      }
      return cloneToolResult({
        tool_name: "get_raw_events",
        results: [{ content: "wiki ok: get_raw_events" }],
        summary: "wiki ok: get_raw_events",
        facts: extractWikiFacts("get_raw_events", filteredPayload),
        data: filteredPayload,
        partial: entry.result.partial ?? false,
        error: entry.result.error,
      })
    }

    return null
  }


  private getConfigForTool(toolName: string): SearchProviderConfig {
    switch (toolName) {
      case "web_search":
        return { apiKey: this.keys.braveSearchApiKey || this.keys.serpapiApiKey }
      case "deep_research":
        return { apiKey: this.keys.exaApiKey }
      case "synthesized_search":
        return { apiKey: this.keys.perplexityApiKey }
      case "public_interest":
        return { apiKey: this.keys.serpapiApiKey }
      case "market_context":
        return {} // CoinGecko is free
      default:
        return {}
    }
  }
}

function extractWikiFacts(toolName: string, payload: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case "get_collection_context":
      return {
        collection_slug: payload.collection_slug,
        collection_size: payload.collection_size,
        collection_size_source: payload.collection_size_source,
        source: payload.source,
      }
    case "get_raw_events":
      return {
        inscription_id: payload.inscription_id,
        event_count: payload.event_count,
      }
    case "get_timeline":
      return {
        inscription_id: payload.inscription_id,
        source: payload.source,
      }
    default:
      return {}
  }
}

function sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...args }

  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") {
      let cleaned = value.trim()
      
      // Fields that definitely should NOT have newlines or extra spaces
      const isIdentifier = /^(inscription_?id|address|slug|collection_?slug|taproot_?address|txid|id)$/i.test(key)
      
      if (isIdentifier) {
        cleaned = cleaned.replace(/\s+/g, "").toLowerCase()
      } else {
        // General text fields: trim newlines into spaces
        cleaned = cleaned.replace(/\n+/g, " ").replace(/\s{2,}/g, " ")
      }
      
      sanitized[key] = cleaned
    }
  }

  return sanitized
}

function buildToolCacheKey(toolName: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    toolName,
    args: canonicalizeValue(args),
  })
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => canonicalizeValue(item))
    if (normalized.every((item) => typeof item === "string")) {
      return [...(normalized as string[])].sort()
    }
    return normalized
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, canonicalizeValue(entryValue)])
    return Object.fromEntries(entries)
  }

  return value
}

function cloneToolResult(result: SearchToolResult): SearchToolResult {
  return {
    ...result,
    results: result.results.map((item) => ({ ...item })),
    facts: result.facts ? { ...result.facts } : undefined,
    data: result.data ? cloneRecord(result.data) : undefined,
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function normalizeEventTypes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (normalized.length === 0) return null
  return Array.from(new Set(normalized)).sort()
}

function normalizeLimit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function canReuseRawEvents(
  requestedEventTypes: string[] | null,
  cachedEventTypes: string[] | null,
  cachedIsComplete: boolean
): boolean {
  if (!requestedEventTypes) {
    return cachedEventTypes === null
  }

  if (cachedEventTypes === null) {
    return cachedIsComplete
  }

  if (!cachedIsComplete) return false

  const cachedSet = new Set(cachedEventTypes)
  return requestedEventTypes.every((eventType) => cachedSet.has(eventType))
}

function filterRawEventsByType(events: unknown[], requestedEventTypes: string[] | null): Record<string, unknown>[] {
  const rawEvents = events.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
  if (!requestedEventTypes) return rawEvents.map((event) => cloneRecord(event))

  const allowed = new Set(requestedEventTypes)
  return rawEvents
    .filter((event) => typeof event.event_type === "string" && allowed.has(event.event_type.toLowerCase()))
    .map((event) => cloneRecord(event))
}
