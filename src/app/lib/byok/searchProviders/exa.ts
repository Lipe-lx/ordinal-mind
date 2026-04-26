import type { SearchProvider, SearchToolResult } from "./types"

export const exaProvider: SearchProvider = {
  name: "deep_research",
  execute: async (args, config) => {
    const query = args.query as string | undefined
    if (!query) {
      return { tool_name: "deep_research", results: [], error: "Missing query" }
    }

    if (!config.apiKey) {
      return { tool_name: "deep_research", results: [], error: "Exa API key not configured" }
    }

    try {
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify({
          query,
          numResults: 2,
          contents: { text: { maxCharacters: 4000 } },
        }),
      })

      if (!res.ok) {
        throw new Error(`Exa API error: ${res.status}`)
      }

      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = data.results || []

      return {
        tool_name: "deep_research",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results: results.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.text || r.summary || "",
          published_date: r.publishedDate,
        })),
      }
    } catch (e) {
      return { tool_name: "deep_research", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
