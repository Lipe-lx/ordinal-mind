import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildXMentionQueries,
  extractBingUrl,
  extractDDGUrl,
  normalizeXMentionUrl,
  parseBingResults,
  parseDDGResults,
  scrapeXMentions,
} from "../../src/worker/agents/xsearch"

describe("xsearch", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("builds precise queries for inscription discovery", () => {
    expect(buildXMentionQueries(`${"a".repeat(64)}i0`, 2971, {
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
      officialXUrls: ["https://x.com/bitcoinpuppets"],
    })).toEqual([
      'site:x.com/status "Bitcoin Puppet #2971" "Bitcoin Puppets"',
      'site:x.com/status "Bitcoin Puppet #2971"',
      'site:x.com/status "Bitcoin Puppets"',
      'site:twstalker.com "Bitcoin Puppet #2971" "Bitcoin Puppets"',
      'site:twstalker.com "Bitcoin Puppet #2971"',
      'site:twstalker.com "Bitcoin Puppets"',
      'site:twstalker.com "bitcoinpuppets" "Bitcoin Puppets"',
      'site:x.com/bitcoinpuppets/status "Bitcoin Puppet #2971"',
      'site:x.com/bitcoinpuppets/status "Bitcoin Puppets"',
      'site:x.com "bitcoinpuppets" "Bitcoin Puppet #2971"',
      'site:x.com "bitcoinpuppets" "Bitcoin Puppets"',
      "site:x.com/bitcoinpuppets/status",
      'site:x.com/puppets/status "Bitcoin Puppet #2971"',
      'site:x.com/puppets/status "Bitcoin Puppets"',
      'site:x.com "puppets" "Bitcoin Puppet #2971"',
      'site:x.com "puppets" "Bitcoin Puppets"',
      "site:x.com/puppets/status",
      'site:twitter.com "Bitcoin Puppet #2971" "Bitcoin Puppets"',
      'site:twitter.com "Bitcoin Puppet #2971"',
      'site:twitter.com "Bitcoin Puppets"',
      'site:twitter.com "bitcoinpuppets" "Bitcoin Puppet #2971"',
      'site:twitter.com "bitcoinpuppets" "Bitcoin Puppets"',
      `site:x.com/status "${"a".repeat(64)}i0"`,
      'site:x.com/status "inscription 2971"',
    ])
  })

  it("normalizes status permalinks and rejects non-status X urls", () => {
    expect(
      normalizeXMentionUrl("https://twitter.com/collector/status/1234567890?s=20")
    ).toBe("https://x.com/collector/status/1234567890")

    expect(
      normalizeXMentionUrl("https://mobile.twitter.com/collector/status/1234567890")
    ).toBe("https://x.com/collector/status/1234567890")

    expect(normalizeXMentionUrl("https://x.com/collector")).toBeNull()
  })

  it("extracts and deduplicates DDG results into canonical X permalinks", () => {
    const foundAt = "2026-04-25T00:00:00.000Z"
    const html = `
      <div class="result results_links">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftwitter.com%2Fcollector%2Fstatus%2F1234567890%3Fs%3D20">
          Inscription 2971 on X
        </a>
        <a class="result__snippet" href="#">
          Collector mentions the piece.
        </a>
      </div>
      <div class="result results_links">
        <a class="result__a" href="https://x.com/collector/status/1234567890">
          Duplicate canonical link
        </a>
        <div class="result__snippet">
          Same post, different DDG output.
        </div>
      </div>
      <div class="result results_links">
        <a class="result__a" href="https://x.com/collector">
          Profile page
        </a>
        <div class="result__snippet">
          Should be ignored because it is not a post permalink.
        </div>
      </div>
    `

    expect(parseDDGResults(html, foundAt)).toEqual([
      {
        url: "https://x.com/collector/status/1234567890",
        title: "Inscription 2971 on X",
        snippet: "Collector mentions the piece.",
        found_at: foundAt,
      },
    ])
  })

  it("falls back from DDG POST to GET when POST yields nothing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === "https://html.duckduckgo.com/html/" && init?.method === "POST") {
        return new Response("", { status: 503 })
      }

      if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
        return new Response(`
          <div class="result results_links">
            <a class="result__a" href="https://x.com/ordinalmind/status/999999">
              Chronicle mention found
            </a>
            <div class="result__snippet">
              Exact inscription match surfaced through fallback.
            </div>
          </div>
        `, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      }

      return new Response(`unexpected url: ${url}`, { status: 404 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const mentions = await scrapeXMentions(`${"a".repeat(64)}i0`, {
      inscriptionNumber: 2971,
      queryDelayMs: 0,
    })

    expect(mentions).toEqual([
      {
        url: "https://x.com/ordinalmind/status/999999",
        title: "Chronicle mention found",
        snippet: "Exact inscription match surfaced through fallback.",
        found_at: expect.any(String),
      },
    ])

    expect(fetchMock).toHaveBeenCalled()
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://html.duckduckgo.com/html/?q="))
    ).toBe(true)
  })

  it("records query diagnostics for failed discovery", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)

    const diagnostics = {
      official_x_urls: [] as string[],
      candidate_handles: [] as string[],
      queries: [] as string[],
      attempts: [] as Array<{
        provider: "ddg" | "bing"
        transport: "POST" | "GET"
        query: string
        outcome: "query_completed" | "non_ok" | "fetch_failed" | "transport_unavailable"
        status?: number
        mention_count?: number
      }>,
    }

    const mentions = await scrapeXMentions(`${"a".repeat(64)}i0`, {
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
      officialXUrls: ["https://x.com/bitcoinpuppets"],
      diagnostics,
      queryDelayMs: 0,
    })

    expect(mentions).toEqual([])
    expect(diagnostics.queries[0]).toBe('site:x.com/status "Bitcoin Puppet #2971" "Bitcoin Puppets"')
    expect(diagnostics.official_x_urls).toEqual(["https://x.com/bitcoinpuppets"])
    expect(diagnostics.candidate_handles).toContain("bitcoinpuppets")
    expect(diagnostics.attempts).toContainEqual(expect.objectContaining({
      provider: "ddg",
      transport: "POST",
      outcome: "non_ok",
      status: 503,
    }))
  })

  it("continues across a single transport failure before stopping the provider", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === "https://html.duckduckgo.com/html/" && init?.method === "POST") {
        const body = new URLSearchParams(String(init.body ?? ""))
        const query = body.get("q") ?? ""

        if (query === 'site:x.com/status "Bitcoin Puppets"') {
          return new Response("temporary failure", { status: 503 })
        }

        if (query === 'site:x.com/status "inscription 2971"') {
          return new Response(`
            <div class="result results_links">
              <a class="result__a" href="https://twitter.com/ordinalmind/status/1234567890">
                Fallback mention found
              </a>
              <div class="result__snippet">
                Discovery kept going after one failed query.
              </div>
            </div>
          `, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        }

        return new Response("", { status: 200 })
      }

      return new Response(`unexpected url: ${url}`, { status: 404 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const diagnostics = {
      official_x_urls: [] as string[],
      candidate_handles: [] as string[],
      queries: [] as string[],
      attempts: [] as Array<{
        provider: "ddg" | "bing"
        transport: "POST" | "GET"
        query: string
        outcome: "query_completed" | "non_ok" | "fetch_failed" | "transport_unavailable"
        status?: number
        mention_count?: number
      }>,
    }

    const mentions = await scrapeXMentions(`${"a".repeat(64)}i0`, {
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
      officialXUrls: ["https://x.com/bitcoinpuppets"],
      diagnostics,
      queryDelayMs: 0,
    })

    expect(mentions).toEqual([
      {
        url: "https://x.com/ordinalmind/status/1234567890",
        title: "Fallback mention found",
        snippet: "Discovery kept going after one failed query.",
        found_at: expect.any(String),
      },
    ])

    expect(diagnostics.attempts).toContainEqual(expect.objectContaining({
      provider: "ddg",
      transport: "POST",
      outcome: "non_ok",
      status: 503,
    }))
    expect(diagnostics.attempts).not.toContainEqual(expect.objectContaining({
      provider: "ddg",
      transport: "POST",
      outcome: "transport_unavailable",
    }))
  })

  it("parses Bing results into canonical X permalinks", () => {
    const foundAt = "2026-04-25T00:00:00.000Z"
    const wrappedUrl = `https://www.bing.com/ck/a?u=a1${btoa("https://twitter.com/bitcoinweirdos/status/1234567890?s=20")}&ntb=1`
    const html = `
      <li class="b_algo">
        <h2><a href="${wrappedUrl}">Bitcoin Weirdos #122 on X</a></h2>
        <div class="b_caption"><p>For the weirdos, for the world.</p></div>
      </li>
    `

    expect(parseBingResults(html, foundAt)).toEqual([
      {
        url: "https://x.com/bitcoinweirdos/status/1234567890",
        title: "Bitcoin Weirdos #122 on X",
        snippet: "For the weirdos, for the world.",
        found_at: foundAt,
      },
    ])
  })

  it("parses Bing mirror results as public X references", () => {
    const foundAt = "2026-04-25T00:00:00.000Z"
    const wrappedUrl = `https://www.bing.com/ck/a?u=a1${btoa("https://twstalker.com/TokenJokin?lang=en")}&ntb=1`
    const html = `
      <li class="b_algo">
        <h2><a href="${wrappedUrl}">TokenJokin @TokenJokin - Twitter Profile | TwStalker</a></h2>
        <div class="b_caption"><p>Yapp: BITCOIN WEIRDOS ARE ENTERING THEIR FINAL FORM.</p></div>
      </li>
    `

    expect(parseBingResults(html, foundAt)).toEqual([
      {
        url: "https://twstalker.com/TokenJokin",
        title: "TokenJokin @TokenJokin - Twitter Profile | TwStalker",
        snippet: "Yapp: BITCOIN WEIRDOS ARE ENTERING THEIR FINAL FORM.",
        found_at: foundAt,
      },
    ])
  })

  it("lets Bing reach public mirror queries after initial direct-query failures", async () => {
    const wrappedUrl = `https://www.bing.com/ck/a?u=a1${btoa("https://twstalker.com/TokenJokin?lang=en")}&ntb=1`
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response("ddg unavailable", { status: 503 })
      }

      if (url.startsWith("https://www.bing.com/search")) {
        const query = new URL(url).searchParams.get("q") ?? ""
        if (query.startsWith("site:twstalker.com")) {
          return new Response(`
            <li class="b_algo">
              <h2><a href="${wrappedUrl}">TokenJokin @TokenJokin - Twitter Profile | TwStalker</a></h2>
              <div class="b_caption"><p>Yapp: BITCOIN PUPPETS ARE ENTERING THEIR FINAL FORM.</p></div>
            </li>
          `, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        }
        return new Response("direct query unavailable", { status: 503 })
      }

      return new Response(`unexpected url: ${url}`, { status: 404 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const mentions = await scrapeXMentions(`${"a".repeat(64)}i0`, {
      inscriptionNumber: 2971,
      collectionName: "Bitcoin Puppets",
      itemName: "Bitcoin Puppet #2971",
      queryDelayMs: 0,
    })

    expect(mentions).toEqual([
      {
        url: "https://twstalker.com/TokenJokin",
        title: "TokenJokin @TokenJokin - Twitter Profile | TwStalker",
        snippet: "Yapp: BITCOIN PUPPETS ARE ENTERING THEIR FINAL FORM.",
        found_at: expect.any(String),
      },
    ])
  })

  it("extracts direct and wrapped DDG urls", () => {
    expect(
      extractDDGUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com%2Ffoo%2Fstatus%2F1")
    ).toBe("https://x.com/foo/status/1")

    expect(extractDDGUrl("https://x.com/foo/status/1")).toBe("https://x.com/foo/status/1")
  })

  it("extracts wrapped Bing urls", () => {
    expect(
      extractBingUrl(`https://www.bing.com/ck/a?u=a1${btoa("https://x.com/foo/status/1")}&ntb=1`)
    ).toBe("https://x.com/foo/status/1")
  })
})
