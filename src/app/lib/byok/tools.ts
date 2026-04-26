import type { ResearchKeys } from "./toolExecutor"

export interface SearchToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  requiresKeys?: (keyof ResearchKeys)[]
}

// Global list of search tools exposed to the LLM
export const COLLECTION_RESEARCH_TOOLS: SearchToolDefinition[] = [
  {
    name: "web_search",
    requiresKeys: ["braveSearchApiKey", "serpapiApiKey"],
    description: "Search the web for cultural context, history, lore, creator info, milestones, and community reception of a Bitcoin Ordinals collection. Use this to find articles, blog posts, and community discussions about the collection.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query focused on the collection name and relevant context" },
      },
      required: ["query"],
    },
  },
  {
    name: "deep_research",
    requiresKeys: ["exaApiKey"],
    description: "Semantic search for in-depth articles, essays, and deep dives about an Ordinals collection. Returns full article content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic to research deeply" },
      },
      required: ["query"],
    },
  },
  {
    name: "synthesized_search",
    requiresKeys: ["perplexityApiKey"],
    description: "Get a synthesized answer with citations about a specific question regarding a collection's history or significance.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "A specific question to answer" },
      },
      required: ["question"],
    },
  },
  {
    name: "market_context",
    description: "Get current market data (price, volume, market cap) for a cryptocurrency to contextualize macro conditions.",
    parameters: {
      type: "object",
      properties: {
        coin_id: { type: "string", description: "CoinGecko ID of the coin (e.g., 'bitcoin', 'solana')" },
      },
      required: ["coin_id"],
    },
  },
  {
    name: "public_interest",
    requiresKeys: ["serpapiApiKey"],
    description: "Get Google Trends data showing public search interest over time for a topic.",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword to check search interest for" },
      },
      required: ["keyword"],
    },
  },
]
