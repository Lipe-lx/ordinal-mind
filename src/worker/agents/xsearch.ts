// X mentions discovery via DuckDuckGo HTML scraping.
// Uses Cloudflare HTMLRewriter (native, zero dependencies).
// Rate limit: 2s between queries, max 8 results per query.

export interface XMention {
  url: string
  title: string
  snippet: string
  found_at: string // ISO timestamp of when the scrape happened
}

export async function scrapeXMentions(inscriptionId: string): Promise<XMention[]> {
  // Search by short hash (first 8 chars of inscription ID)
  const shortHash = inscriptionId.substring(0, 8)
  const queries = [
    `site:x.com "inscription ${shortHash}"`,
    `site:x.com "${shortHash}"`,
  ]

  const allMentions: XMention[] = []

  for (let i = 0; i < queries.length; i++) {
    const mentions = await scrapeDDG(queries[i])
    allMentions.push(...mentions)

    // Rate limit: wait 2s between queries
    if (i < queries.length - 1) {
      await sleep(2000)
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return allMentions.filter((m) => {
    if (seen.has(m.url)) return false
    seen.add(m.url)
    return true
  })
}

async function scrapeDDG(query: string): Promise<XMention[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ordinal-mind/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return [] // timeout or network error — don't block the pipeline
  }

  if (!res.ok) return []

  const mentions: XMention[] = []
  let current: Partial<XMention> = {}

  // Use Cloudflare's native HTMLRewriter to parse DDG results
  await new HTMLRewriter()
    .on(".result__title a", {
      element(el) {
        const href = el.getAttribute("href") ?? ""
        // DDG wraps links — extract real URL from the uddg parameter
        const real = extractDDGUrl(href)
        if (real && (real.includes("x.com/") || real.includes("twitter.com/"))) {
          current = {
            url: real,
            title: "",
            snippet: "",
            found_at: new Date().toISOString(),
          }
        }
      },
      text(chunk) {
        if (current.url && chunk.text) {
          current.title = (current.title ?? "") + chunk.text
        }
      },
    })
    .on(".result__snippet", {
      text(chunk) {
        if (current.url && chunk.text) {
          current.snippet = (current.snippet ?? "") + chunk.text
          // Consider the result complete when snippet text node ends
          if (chunk.lastInTextNode && current.url) {
            mentions.push(current as XMention)
            current = {}
          }
        }
      },
    })
    .transform(res)
    .text() // consume the response stream

  return mentions.slice(0, 8) // max 8 mentions per query
}

function extractDDGUrl(href: string): string | null {
  try {
    // DDG redirects via //duckduckgo.com/l/?uddg=<encoded>
    if (href.includes("uddg=")) {
      const u = new URL("https://x.com" + href)
      const uddg = u.searchParams.get("uddg")
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith("http")) return href
    return null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
