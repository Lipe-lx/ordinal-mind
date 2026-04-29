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
    description: "Search the Ordinal Mind wiki for inscription, collection, artist, or sat pages. Use this for contextual background, named entities, and relationship discovery. Do not use it as the only source for precise transfer, mint, sale, or supply claims when a factual event tool is available.",
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
    description: "Fetch immutable Layer 0 events for a specific inscription. Use this first for precise factual claims about mint, transfers, sales, timestamps, and provenance. The response is event-level data and is better for exact answers than wiki summaries.",
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
    description: "Return the rendered Chronicle timeline for an inscription from cache, with Layer 0 fallback. Use this when you need a concise factual view of the full event history rather than raw event rows.",
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
    description: "Return public collection context for a collection slug or inscription id. Use this for collection-level facts such as the mapped collection size, wiki summary, and collection metadata. Prefer this over broad web search for short factual questions like collection size.",
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
    description: "Search the public web for cultural context, history, lore, creator information, milestones, and community reception of a Bitcoin Ordinals collection. Use this for broad narrative context only, not for exact event counts, owner fields, or mint timestamps.",
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
    description: "Run semantic search across long-form articles and deep dives about an Ordinals collection. Use this only for broad narrative or historical context, not for short factual answers that can be resolved from Chronicle data or wiki tools.",
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
    description: "Get a synthesized cited answer about a collection's history or significance. Use this for contextual follow-up when direct Chronicle data and wiki tools are insufficient, not as the primary source for exact on-chain claims.",
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
    description: "Get current market data such as price, volume, and market cap for a cryptocurrency. Use this only when macro market conditions are relevant to a broader narrative.",
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
    description: "Get Google Trends style public-interest data for a topic over time. Use this for collector attention context, not for precise inscription or collection facts.",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Keyword to check search interest for" },
      },
      required: ["keyword"],
    },
  },
]
