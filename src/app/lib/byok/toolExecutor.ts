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
  status: "running" | "done" | "error"
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
  private maxCalls = 6
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
      return { tool_name: toolName, results: [], error }
    }
    
    this.callCount++
    console.log(`[ToolExecutor] Executing ${toolName} (Call ${this.callCount}/${this.maxCalls})`, args)
    this.onLog?.({ id, tool: toolName, args, status: "running" })

    if (WIKI_TOOL_NAMES.has(toolName)) {
      try {
        const payload = await executeWikiTool(toolName, args)
        const error = typeof payload.error === "string" ? payload.error : undefined
        const summary = error
          ? `wiki error: ${error}`
          : `wiki ok: ${toolName}`
        this.onLog?.({ id, tool: toolName, args, status: error ? "error" : "done", result: summary, error })
        return {
          tool_name: toolName,
          results: [{ content: summary }],
          data: payload,
          error,
        }
      } catch (e) {
        const error = String(e)
        this.onLog?.({ id, tool: toolName, args, status: "error", error })
        return { tool_name: toolName, results: [], error }
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
      return { tool_name: toolName, results: [], error }
    }

    const config = this.getConfigForTool(toolName)
    try {
      const result = await provider.execute(args, config)
      
      if (result.error) {
        this.onLog?.({ id, tool: toolName, args, status: "error", error: result.error })
      } else {
        const resultSummary = result.results.map(r => r.title || (r.content ? (r.content.substring(0, 50) + "...") : "No content")).join(", ")
        this.onLog?.({ id, tool: toolName, args, status: "done", result: resultSummary })
      }
      
      return result
    } catch (e) {
      const error = String(e)
      console.error(`[ToolExecutor] Error executing ${toolName}:`, e)
      this.onLog?.({ id, tool: toolName, args, status: "error", error })
      return { tool_name: toolName, results: [], error }
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
