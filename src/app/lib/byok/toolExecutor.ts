import { braveProvider } from "./searchProviders/brave"
import { exaProvider } from "./searchProviders/exa"
import { perplexityProvider } from "./searchProviders/perplexity"
import { coingeckoProvider } from "./searchProviders/coingecko"
import { serpapiProvider } from "./searchProviders/serpapi"
import type { SearchToolResult, SearchProviderConfig } from "./searchProviders/types"

const PROVIDERS = {
  web_search: braveProvider,
  deep_research: exaProvider,
  synthesized_search: perplexityProvider,
  market_context: coingeckoProvider,
  public_interest: serpapiProvider,
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

  constructor(keys: ResearchKeys) {
    this.keys = keys
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<SearchToolResult> {
    if (this.callCount >= this.maxCalls) {
      return { tool_name: toolName, results: [], error: "Maximum tool call limit reached." }
    }
    
    this.callCount++
    console.log(`[ToolExecutor] Executing ${toolName} (Call ${this.callCount}/${this.maxCalls})`, args)

    const provider = Object.values(PROVIDERS).find(p => p.name === toolName)
    if (!provider) {
      return { tool_name: toolName, results: [], error: `Unknown tool: ${toolName}` }
    }

    const config = this.getConfigForTool(toolName)
    try {
      const result = await provider.execute(args, config)
      return result
    } catch (e) {
      console.error(`[ToolExecutor] Error executing ${toolName}:`, e)
      return { tool_name: toolName, results: [], error: String(e) }
    }
  }

  private getConfigForTool(toolName: string): SearchProviderConfig {
    switch (toolName) {
      case "web_search":
        return { apiKey: this.keys.braveSearchApiKey }
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
