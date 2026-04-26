import type { WebResearchContext, WebResearchItem } from "../../app/lib/types"

const FALLBACK_INSTANCES = [
  "https://searx.be",
  "https://searx.tiekoetter.com",
  "https://searx.monocles.de",
  "https://searx.divided-by-zero.eu",
  "https://searx.work",
  "https://searx.nixnet.services",
  "https://searx.fmac.xyz",
  "https://priv.au",
  "https://ooglester.com",
  "https://baresearch.org",
]

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Cache discovery in memory (persists within the same isolate)
let discoveredInstances: string[] = []
let lastDiscoveryTime = 0
const DISCOVERY_CACHE_TTL = 1000 * 60 * 60 * 12 // 12 hours

interface SearXNGInstanceInfo {
  http?: {
    status_code: number
  }
  timing?: {
    search?: {
      success_percentage: number
      all?: {
        median: number
      }
    }
  }
}

interface SearXNGInstancesData {
  instances: Record<string, SearXNGInstanceInfo>
}

async function discoverInstances(): Promise<string[]> {
  const now = Date.now()
  if (discoveredInstances.length > 0 && now - lastDiscoveryTime < DISCOVERY_CACHE_TTL) {
    return discoveredInstances
  }

  try {
    const res = await fetch("https://searx.space/data/instances.json", {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error("Failed to fetch instances")

    const data = (await res.json()) as SearXNGInstancesData
    if (!data.instances) throw new Error("Invalid instances.json format")

    const candidates = Object.entries(data.instances)
      .filter(([_url, info]) => {
        // Higher quality criteria for 2026: 200 OK, >98% success rate, <1.5s response time
        return (
          info.http?.status_code === 200 &&
          (info.timing?.search?.success_percentage ?? 0) > 98 &&
          (info.timing?.search?.all?.median ?? 99) < 1.5
        )
      })
      .map(([url, info]) => ({
        url: url.replace(/\/$/, ""),
        score: (info.timing?.search?.success_percentage ?? 0) / (info.timing?.search?.all?.median ?? 1)
      }))
      .filter(({ url }) => !url.includes(".onion") && url.startsWith("https://"))
      .sort((a, b) => b.score - a.score) // Sort by our custom reliability score
      .map(c => c.url)

    if (candidates.length > 3) {
      // Keep top 20 most reliable ones
      discoveredInstances = candidates.slice(0, 20)
      lastDiscoveryTime = now
      console.log(`[WebResearch] Discovered ${discoveredInstances.length} high-quality SearXNG instances`)
      return discoveredInstances
    }
  } catch (e) {
    console.warn("[WebResearch] Discovery failed, using fallback list", e)
  }

  return FALLBACK_INSTANCES
}

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

  // 1. Search via SearXNG (with parallel racing)
  let searchResults = await searchSearXNG(query)
  
  // 2. Fallback to DuckDuckGo Lite if SearXNG fails
  if (!searchResults || searchResults.length === 0) {
    console.log("[WebResearch] SearXNG failed or empty, falling back to DuckDuckGo Lite")
    searchResults = await searchDuckDuckGoLite(query)
  }

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
  const pool = await discoverInstances()
  // Shuffle but keep reliable ones near the front
  const instances = [...pool].sort(() => Math.random() - 0.5).slice(0, 12)

  // Race in batches of 3 to avoid overwhelming the network but find a fast result
  const batchSize = 3
  for (let i = 0; i < instances.length; i += batchSize) {
    const batch = instances.slice(i, i + batchSize)
    try {
      const result = await Promise.any(
        batch.map(instance => searchSingleSearXNG(instance, query))
      )
      if (result && result.length > 0) return result
    } catch {
      // If a whole batch fails, continue to next batch
      continue
    }
  }

  return []
}

async function searchSingleSearXNG(instance: string, query: string): Promise<SearXNGResult[]> {
  const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(5000), // Strict timeout for racing
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as SearXNGResponse
  if (!data.results || data.results.length === 0) throw new Error("No results")
  return data.results
}

async function searchDuckDuckGoLite(query: string): Promise<SearXNGResult[]> {
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return []

    const results: SearXNGResult[] = []
    let currentResult: Partial<SearXNGResult> = {}

    const rewriter = new HTMLRewriter()
      .on("a.result-link", {
        element(el) {
          const href = el.getAttribute("href")
          if (href) {
            // DDG Lite URLs are proxied: //duckduckgo.com/l/?uddg=URL...
            const match = href.match(/[?&]uddg=([^&]+)/)
            const actualUrl = match ? decodeURIComponent(match[1]) : href
            currentResult.url = actualUrl.startsWith("//") ? "https:" + actualUrl : actualUrl
          }
        },
        text(chunk) {
          currentResult.title = (currentResult.title || "") + chunk.text
        }
      })
      .on("td.result-snippet", {
        text(chunk) {
          currentResult.content = (currentResult.content || "") + chunk.text
        }
      })
      // The snippet is usually the last part of a result block in DDG Lite
      .on("span.link-text", {
        element() {
          if (currentResult.title && currentResult.url) {
            results.push({
              title: currentResult.title.trim(),
              url: currentResult.url,
              content: (currentResult.content || "").trim(),
            })
          }
          currentResult = {} // Reset for next result
        }
      })

    await rewriter.transform(res).text()
    return results
  } catch (e) {
    console.error("[WebResearch] DDG Lite search failed:", e)
    return []
  }
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
