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

  constructor(keys: ResearchKeys, onLog?: (log: ResearchLog) => void) {
    this.keys = keys
    this.onLog = onLog
  }

  public getKeys(): ResearchKeys {
    return this.keys
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<SearchToolResult> {
    const id = Math.random().toString(36).substring(2, 9)
    
    if (this.callCount >= this.maxCalls) {
      const error = "Maximum tool call limit reached."
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }
    
    this.callCount++
    console.log(`[ToolExecutor] Executing ${toolName} (Call ${this.callCount}/${this.maxCalls})`, args)
    this.onLog?.({ id, tool: toolName, args, status: "running" })

    if (WIKI_TOOL_NAMES.has(toolName)) {
      try {
        const payload = await executeWikiTool(toolName, args)
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
        return {
          tool_name: toolName,
          results: [{ content: summary }],
          summary,
          facts: extractWikiFacts(toolName, payload),
          data: payload,
          partial,
          error,
        }
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
      const error = `Unknown tool: ${toolName}`
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }

    const config = this.getConfigForTool(toolName)
    try {
      const result = await provider.execute(args, config)
      const summary = result.summary
        ?? result.results.map(r => r.title || (r.content ? `${r.content.substring(0, 50)}...` : "No content")).join(", ")
      
      if (result.error) {
        this.onLog?.({ id, tool: toolName, args, status: result.partial ? "partial" : "error", error: result.error, result: summary })
      } else {
        this.onLog?.({ id, tool: toolName, args, status: result.partial ? "partial" : "done", result: summary })
      }
      
      return {
        ...result,
        summary,
        partial: result.partial ?? false,
      }
    } catch (e) {
      const error = String(e)
      console.error(`[ToolExecutor] Error executing ${toolName}:`, e)
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], summary: error, error, partial: false }
    }
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
