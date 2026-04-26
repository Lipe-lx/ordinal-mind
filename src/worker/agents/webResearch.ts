import type { WebResearchContext, WebResearchItem } from "../../app/lib/types"

const SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://searx.tiekoetter.com",
  "https://searx.monocles.de",
  "https://searx.divided-by-zero.eu",
  "https://search.ononoki.org",
  "https://searx.nixnet.services",
  "https://searx.fmac.xyz",
  "https://priv.au",
]

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

interface SearXNGResult {
  title: string
  url: string
  content: string
}

interface SearXNGResponse {
  results?: SearXNGResult[]
}

export async function fetchLoreContext(collectionName: string): Promise<WebResearchContext | null> {
  if (!collectionName) return null

  const query = `${collectionName} Ordinals Bitcoin lore history`
  const results: WebResearchItem[] = []
  const fetchedAt = new Date().toISOString()

  // 1. Search via SearXNG
  const searchResults = await searchSearXNG(query)
  if (!searchResults || searchResults.length === 0) return null

  // 2. Select top 3 relevant results (excluding marketplaces if possible)
  const candidates = searchResults
    .filter(r => !r.url.includes("magiceden.io") && !r.url.includes("okx.com") && !r.url.includes("ordinalswallet.com"))
    .slice(0, 3)

  // 3. Extract content for each candidate
  for (const candidate of candidates) {
    const content = await extractContent(candidate.url)
    results.push({
      title: candidate.title,
      url: candidate.url,
      snippet: candidate.content,
      content: content || undefined,
      source: "searxng",
    })
  }

  return {
    query,
    results,
    fetched_at: fetchedAt,
  }
}

async function searchSearXNG(query: string): Promise<SearXNGResult[]> {
  // Shuffle instances for basic load balancing
  const instances = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5)

  for (const instance of instances) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json`
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(6000), // Fast timeout for search
      })

      if (res.ok) {
        const data = (await res.json()) as SearXNGResponse
        return data.results || []
      }
    } catch (e) {
      console.warn(`[WebResearch] SearXNG instance ${instance} failed:`, e)
      continue
    }
  }

  return []
}

async function extractContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8000), // Slightly longer for content fetch
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
      // Simple noise reduction: avoid common boilerplate containers
      .on("nav, footer, script, style, .sidebar, .menu, .ads", {
        element(el) {
          el.remove()
        }
      })

    await rewriter.transform(res).text()
    
    // Final cleanup: trim and limit length
    return content.trim().substring(0, 5000)
  } catch (e) {
    console.warn(`[WebResearch] Failed to extract content from ${url}:`, e)
    return null
  }
}
