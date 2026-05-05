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
  "https://searx.tiekoetter.com",
  "https://searx.rhscz.eu",
  "https://searxng.nicfab.eu",
]

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Cache discovery in memory (persists within the same isolate)
let discoveredInstances: string[] = []
let lastDiscoveryTime = 0
const DISCOVERY_CACHE_TTL = 1000 * 60 * 60 * 12 // 12 hours
const deadInstances = new Set<string>()
let lastBlacklistClear = Date.now()
const BLACKLIST_TTL = 1000 * 60 * 60 // 1 hour (increased for 2026 resilience)

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

interface WikipediaResult {
  title: string
  snippet: string
}

export async function fetchLoreContext(collectionName: string): Promise<WebResearchContext | null> {
  if (!collectionName) return null

  const query = `${collectionName} Ordinals lore`
  const results: WebResearchItem[] = []
  const fetchedAt = new Date().toISOString()

  // 1. Search via SearXNG (with parallel racing)
  let searchResults = await searchSearXNG(query)
  
  // 2. Fallback to Wikipedia if it's a known collection (high trust)
  if (!searchResults || searchResults.length === 0) {
    console.log("[WebResearch] SearXNG failed, trying Wikipedia...")
    searchResults = await searchWikipedia(collectionName)
  }

  // 3. Fallback to Swisscows if all else fails
  if (!searchResults || searchResults.length === 0) {
    console.log("[WebResearch] SearXNG/Wikipedia failed, trying Swisscows...")
    searchResults = await searchSwisscows(query)
  }

  // 4. Fallback to DuckDuckGo Lite as last resort
  if (!searchResults || searchResults.length === 0) {
    console.log("[WebResearch] All primary sources failed, falling back to DuckDuckGo Lite")
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
  const now = Date.now()
  if (now - lastBlacklistClear > BLACKLIST_TTL) {
    deadInstances.clear()
    lastBlacklistClear = now
  }

  const pool = await discoverInstances()
  // Filter out known dead instances and shuffle
  const instances = pool
    .filter(url => !deadInstances.has(url))
    .sort(() => Math.random() - 0.5)
    .slice(0, 20)

  if (instances.length === 0) {
    console.warn("[WebResearch] All discovered instances are blacklisted, clearing blacklist.")
    deadInstances.clear()
    return []
  }

  console.log(`[WebResearch] Attempting search with ${instances.length} active instances in batches of 2`)

  // Race in batches of 2 to find a working instance without hitting global rate limits
  const batchSize = 2
  for (let i = 0; i < instances.length; i += batchSize) {
    const batch = instances.slice(i, i + batchSize)
    try {
      const result = await Promise.any(
        batch.map(instance => searchSingleSearXNG(instance, query))
      )
      if (result && result.length > 0) return result
    } catch (e) {
      // Mark all instances in this batch as potentially dead for this isolate
      batch.forEach(instance => deadInstances.add(instance))
      
      const errors = (e as AggregateError).errors || [e]
      const statuses = errors.map((err: Error | unknown) => (err instanceof Error ? err.message : String(err))).join(", ")
      // Log as debug to avoid cluttering the main console with transient external failures
      console.debug(`[WebResearch] Batch ${i / batchSize + 1} transient failure: ${statuses}`)
      
      await new Promise(resolve => setTimeout(resolve, 500)) // Increased jitter for 2026
      continue
    }
  }

  return []
}

async function searchSingleSearXNG(instance: string, query: string): Promise<SearXNGResult[]> {
  // Use a very standard search URL without complex engine filters that might trigger rate limits
  const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, {
    headers: { 
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(10000), // More generous timeout for public instances
  })

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(`HTTP ${res.status} (Blocked)`)
    }
    throw new Error(`HTTP ${res.status}`)
  }

  const contentType = res.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    const text = await res.text()
    const titleMatch = text.match(/<title>(.*?)<\/title>/i)
    const pageTitle = titleMatch ? titleMatch[1] : "Unknown HTML"
    throw new Error(`Non-JSON response (${pageTitle})`)
  }

  const data = (await res.json()) as SearXNGResponse
  if (!data.results || data.results.length === 0) throw new Error("No results")
  return data.results
}

async function searchWikipedia(term: string): Promise<SearXNGResult[]> {
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

async function searchSwisscows(query: string): Promise<SearXNGResult[]> {
  try {
    const url = `https://swisscows.com/en/web?query=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const text = await res.text()
    
    // Very simple HTML parsing for Swisscows
    const results: SearXNGResult[] = []
    const articleMatch = text.match(/<article.*?>([\s\S]*?)<\/article>/g)
    if (articleMatch) {
      for (const article of articleMatch.slice(0, 5)) {
        const titleMatch = article.match(/<h2.*?>([\s\S]*?)<\/h2>/)
        const linkMatch = article.match(/href="(.*?)"/)
        const snippetMatch = article.match(/<p.*?>([\s\S]*?)<\/p>/)
        
        if (titleMatch?.[1] && linkMatch?.[1]) {
          results.push({
            title: titleMatch[1].replace(/<[^>]*>/g, "").trim(),
            url: linkMatch[1],
            content: snippetMatch?.[1] ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "",
          })
        }
      }
    }
    return results
  } catch {
    return []
  }
}

async function searchDuckDuckGoLite(query: string): Promise<SearXNGResult[]> {
  try {
    // Try /html/ first as it's often more stable than /lite/
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

    const results: SearXNGResult[] = []
    // DDG HTML results are in .result.results_links
    const linkMatches = text.match(/<a class="result__a" href="(.*?)">([\s\S]*?)<\/a>/g)
    const snippetMatches = text.match(/<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g)

    if (linkMatches) {
      linkMatches.slice(0, 5).forEach((link, idx) => {
        const urlMatch = link.match(/href="(.*?)"/)
        const titleMatch = link.match(/>([\s\S]*?)<\/a>/)
        const snippetMatch = snippetMatches?.[idx]?.match(/>([\s\S]*?)<\/a>/)

        if (urlMatch?.[1] && titleMatch?.[1]) {
          // DDG HTML links are proxied: //duckduckgo.com/l/?uddg=URL...
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
