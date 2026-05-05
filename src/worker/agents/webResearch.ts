import type { WebResearchContext, WebResearchItem } from "../../app/lib/types"

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

interface WikipediaResult {
  title: string
  snippet: string
}

export async function fetchLoreContext(collectionName: string): Promise<WebResearchContext | null> {
  if (!collectionName) return null

  const query = `${collectionName} Ordinals lore`
  const results: WebResearchItem[] = []
  const fetchedAt = new Date().toISOString()

  console.log(`[WebResearch] Searching lore for "${collectionName}"...`)

  // 1. Try Wikipedia first (API-based, very stable)
  let searchResults = await searchWikipedia(collectionName)
  let source = "wikipedia"

  // 2. Fallback to DuckDuckGo Lite (Resilient scraping)
  if (!searchResults || searchResults.length === 0) {
    searchResults = await searchDuckDuckGoLite(query)
    source = "duckduckgo"
  }

  if (!searchResults || searchResults.length === 0) {
    console.log("[WebResearch] No results found on Wikipedia or DuckDuckGo.")
    return null
  }

  // 3. Select top 3 relevant results (excluding marketplaces)
  const candidates = searchResults
    .filter(r => !r.url.includes("magiceden.io") && !r.url.includes("okx.com") && !r.url.includes("ordinalswallet.com"))
    .slice(0, 3)

  // 4. Extract content for each candidate
  for (const candidate of candidates) {
    const content = await extractContent(candidate.url)
    results.push({
      title: candidate.title,
      url: candidate.url,
      snippet: candidate.content,
      content: content || undefined,
      source,
    })
  }

  if (results.length === 0) return null

  console.log(`[WebResearch] Found ${results.length} results from ${source}.`)

  return {
    query,
    results,
    fetched_at: fetchedAt,
  }
}

async function searchWikipedia(term: string): Promise<Array<{ title: string; url: string; content: string }>> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&origin=*`
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = await res.json() as { query?: { search?: WikipediaResult[] } }
    const search = data.query?.search || []
    return search.map((r: WikipediaResult) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
      content: r.snippet.replace(/<[^>]*>/g, ""), // Strip HTML tags from snippet
    }))
  } catch {
    return []
  }
}

async function searchDuckDuckGoLite(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://duckduckgo.com/",
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return []
    const text = await res.text()
    
    // Detect CAPTCHA/Block
    if (text.includes("Making sure you're not a bot") || text.includes("anomaly-modal")) {
      console.warn("[WebResearch] DDG blocked our request with a captcha")
      return []
    }

    const results: Array<{ title: string; url: string; content: string }> = []
    const linkMatches = text.match(/<a class="result__a" href="(.*?)">([\s\S]*?)<\/a>/g)
    const snippetMatches = text.match(/<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g)

    if (linkMatches) {
      linkMatches.slice(0, 5).forEach((link, idx) => {
        const urlMatch = link.match(/href="(.*?)"/)
        const titleMatch = link.match(/>([\s\S]*?)<\/a>/)
        const snippetMatch = snippetMatches?.[idx]?.match(/>([\s\S]*?)<\/a>/)

        if (urlMatch?.[1] && titleMatch?.[1]) {
          const rawUrl = urlMatch[1]
          const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/)
          const actualUrl = uddgMatch?.[1] ? decodeURIComponent(uddgMatch[1]) : rawUrl
          
          results.push({
            title: titleMatch[1].replace(/<[^>]*>/g, "").trim(),
            url: actualUrl.startsWith("//") ? "https:" + actualUrl : actualUrl,
            content: snippetMatch?.[1] ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "",
          })
        }
      })
    }
    return results
  } catch (e) {
    console.error("[WebResearch] DDG search failed:", e)
    return []
  }
}

async function extractContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null

    let content = ""
    const rewriter = new HTMLRewriter()
      .on("p, h1, h2, h3, article", {
        text(chunk) {
          const text = chunk.text.trim()
          if (text) {
            content += text + " "
          }
        },
      })
      .on("nav, footer, script, style, .sidebar, .menu, .ads", {
        element(el) {
          el.remove()
        }
      })

    await rewriter.transform(res).text()
    return content.trim().substring(0, 5000)
  } catch (e) {
    console.warn(`[WebResearch] Failed to extract content from ${url}:`, e)
    return null
  }
}
