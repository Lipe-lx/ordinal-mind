import type { SearchProvider, SearchToolResult } from "./types"

export const perplexityProvider: SearchProvider = {
  name: "synthesized_search",
  execute: async (args, config) => {
    const question = args.question as string | undefined
    if (!question) {
      return { tool_name: "synthesized_search", results: [], error: "Missing question" }
    }

    if (!config.apiKey) {
      return { tool_name: "synthesized_search", results: [], error: "Perplexity API key not configured" }
    }

    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            { role: "system", content: "You are a research assistant. Provide a concise, factual answer based on web search. Cite sources." },
            { role: "user", content: question },
          ],
        }),
      })

      if (!res.ok) {
        throw new Error(`Perplexity API error: ${res.status}`)
      }

      const data = await res.json()
      const answer = data.choices?.[0]?.message?.content || ""
      
      // Attempt to extract citations if present (Perplexity returns citations in a specific format)
      // For simplicity, we just return the full text block

      return {
        tool_name: "synthesized_search",
        results: [
          {
            content: answer,
          }
        ],
      }
    } catch (e) {
      return { tool_name: "synthesized_search", results: [], error: e instanceof Error ? e.message : String(e) }
    }
  },
}
