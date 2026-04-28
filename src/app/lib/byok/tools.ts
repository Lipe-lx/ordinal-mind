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
    name: "search_wiki",
    description: "Searches the Ordinal Mind wiki for inscriptions, collections, artists, or sats. Use for contextual background and cross-entity discovery.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query for wiki context" },
        limit: { type: "number", description: "Max results (default 5, max 10)" },
        entity_type: {
          type: "string",
          enum: ["inscription", "collection", "artist", "sat"],
          description: "Optional entity filter",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_raw_events",
    description: "Fetches immutable Layer 0 events for a specific inscription. Prefer this for precise factual claims.",
    parameters: {
      type: "object",
      properties: {
        inscription_id: { type: "string", description: "Inscription id, e.g. <hash>i0" },
        event_types: {
          type: "array",
          items: { type: "string" },
          description: "Optional event type filters",
        },
        limit: { type: "number", description: "Optional max number of events" },
      },
      required: ["inscription_id"],
    },
  },
  {
    name: "get_timeline",
    description: "Returns the rendered timeline for an inscription from cache, with Layer 0 fallback.",
    parameters: {
      type: "object",
      properties: {
        inscription_id: { type: "string", description: "Inscription id, e.g. <hash>i0" },
      },
      required: ["inscription_id"],
    },
  },
  {
    name: "get_collection_context",
    description: "Returns collection wiki context and stats for collection slug or inscription id.",
    parameters: {
      type: "object",
      properties: {
        collection_slug: { type: "string", description: "Collection slug, e.g. bitcoin-frogs" },
        inscription_id: { type: "string", description: "Fallback inscription id when slug is not known" },
      },
    },
  },
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
