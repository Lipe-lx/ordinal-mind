import type { SearchProvider, SearchToolResult } from "./types"

export const braveProvider: SearchProvider = {
  name: "web_search",
  execute: async (args, config) => {
    const query = args.query as string | undefined
    if (!query) {
      return { tool_name: "web_search", results: [], error: "Missing query" }
    }

    if (!config.apiKey) {
      // In a real implementation, we could fallback to the scraping approach here
      // But for this phase, we require an API key
      return { tool_name: "web_search", results: [], error: "Brave API key not configured" }
    }

    try {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": config.apiKey,
        },
      })

      if (!res.ok) {
        throw new Error(`Brave API error: ${res.status}`)
      }

      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webResults = data.web?.results || []

      return {
        tool_name: "web_search",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results: webResults.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.description,
          published_date: r.age,
        })),
      }
    } catch (e) {
      return { tool_name: "web_search", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
