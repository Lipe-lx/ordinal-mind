import type { SearchProvider } from "./types"

interface SerpApiSearchResponse {
  organic_results?: Array<{
    title: string
    link: string
    snippet: string
  }>
}

export const serpapiSearchProvider: SearchProvider = {
  name: "web_search",
  execute: async (args, config) => {
    const query = args.query as string | undefined
    if (!query) {
      return { tool_name: "web_search", results: [], error: "Missing query" }
    }

    if (!config.apiKey) {
      return { tool_name: "web_search", results: [], error: "SerpApi key not configured" }
    }

    try {
      console.log(`[SerpApiSearch] Searching for: ${query}`)
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${config.apiKey}`
      const res = await fetch(url)

      if (!res.ok) {
        console.error(`[SerpApiSearch] HTTP error: ${res.status}`)
        throw new Error(`SerpApi error: ${res.status}`)
      }

      const data = (await res.json()) as SerpApiSearchResponse
      console.log(`[SerpApiSearch] Data received:`, data)
      
      const results = (data.organic_results || []).slice(0, 5).map((r) => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
      }))

      if (results.length === 0) {
         return {
           tool_name: "web_search",
           results: [{ content: `No search results found for "${query}".` }]
         }
      }

      return {
        tool_name: "web_search",
        results,
      }
    } catch (e) {
      return { tool_name: "web_search", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
