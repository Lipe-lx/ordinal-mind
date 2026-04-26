import type { SearchProvider, SearchToolResult } from "./types"

export const serpapiProvider: SearchProvider = {
  name: "public_interest",
  execute: async (args, config) => {
    const keyword = args.keyword as string | undefined
    if (!keyword) {
      return { tool_name: "public_interest", results: [], error: "Missing keyword" }
    }

    if (!config.apiKey) {
      return { tool_name: "public_interest", results: [], error: "SerpApi key not configured" }
    }

    try {
      const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&api_key=${config.apiKey}`
      const res = await fetch(url)

      if (!res.ok) {
        throw new Error(`SerpApi error: ${res.status}`)
      }

      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timeline = data.interest_over_time?.timeline_data || []
      
      if (timeline.length === 0) {
         return {
           tool_name: "public_interest",
           results: [{ content: `No trend data found for "${keyword}".` }]
         }
      }

      // Summarize the trend data to avoid passing huge payloads
      // Just extract the latest data point and maybe the max
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values = timeline.map((d: any) => ({
        date: d.date,
        // Values usually come as arrays because of multiple keywords, here we assume one
        value: parseInt(d.values[0].extracted_value)
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maxPoint = values.reduce((max: any, p: any) => p.value > max.value ? p : max, values[0])
      const currentPoint = values[values.length - 1]

      const content = `Google Trends data for "${keyword}":
- Current interest (relative, 0-100): ${currentPoint.value} (on ${currentPoint.date})
- Peak interest in the past year: ${maxPoint.value} (on ${maxPoint.date})
Analysis: The interest is currently at ${currentPoint.value}% of its peak.`

      return {
        tool_name: "public_interest",
        results: [
          {
            title: `Google Trends: ${keyword}`,
            url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`,
            content: content,
          }
        ],
      }
    } catch (e) {
      return { tool_name: "public_interest", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
