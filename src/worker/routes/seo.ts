import type { Env } from "../index"

interface SeoInscription {
  collection_id?: string
  inscription_number: number
  genesis_block: number
  sat_rarity: string
  genesis_timestamp: string
}

interface SeoCollection {
  title: string
  summary: string | null
}

const BOT_UA_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|gptbot|claudebot|claude-web|anthropic-ai|ccbot|perplexitybot|bimbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|oai-searchbot|chatgpt-user|google-extended/i

const SEO_KV_PREFIX = 'prerender:'
const SEO_CACHE_TTL = 3600
const SITE_URL = "https://ordinalmind.com"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function staticShell(rootHtml: string, options: {
  title: string
  description: string
  canonicalPath: string
  ogType?: "website" | "article"
  twitterCard?: "summary" | "summary_large_image"
  jsonLd?: Record<string, unknown>
}): string {
  const title = escapeHtml(options.title)
  const description = escapeHtml(options.description)
  const canonicalUrl = `${SITE_URL}${options.canonicalPath}`
  const ogType = options.ogType ?? "article"
  const twitterCard = options.twitterCard ?? "summary"
  const jsonLd = options.jsonLd
    ? `\n  <script type="application/ld+json">${JSON.stringify(options.jsonLd)}</script>`
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${SITE_URL}/og/default.png">
  <meta name="twitter:card" content="${twitterCard}">${jsonLd}
</head>
<body>
  ${rootHtml}
  <div id="root"></div>
  <script type="module" src="/src/app/main.tsx"></script>
</body>
</html>`
}

export async function seoMiddleware(
  request: Request,
  env: Env,
  next: () => Promise<Response>
): Promise<Response> {
  const ua = request.headers.get('user-agent') ?? ''
  const url = new URL(request.url)

  if (!BOT_UA_PATTERN.test(ua) || request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp") || url.pathname.match(/\.(js|css|png|jpg|svg|ico)$/)) {
    return next()
  }

  const cacheKey = `${SEO_KV_PREFIX}${url.pathname}`
  try {
    const cached = await env.CHRONICLES_KV.get(cacheKey, 'text')
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-SEO-Cache': 'hit',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  } catch {
    // Ignore KV get error
  }

  try {
    const html = await generateStaticHtml(url.pathname, env)
    if (html) {
      // Background cache write
      env.CHRONICLES_KV.put(cacheKey, html, { expirationTtl: SEO_CACHE_TTL }).catch(() => {})
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-SEO-Cache': 'miss',
        },
      })
    }
  } catch (err) {
    console.error("SEO Prerender Error:", err)
  }

  return next()
}

export async function generateStaticHtml(pathname: string, env: Env): Promise<string | null> {
  if (pathname === "/") return buildHomeHtml()

  // Rota: /chronicle/:inscriptionId
  const chronicleMatch = pathname.match(/^\/chronicle\/([^/]+)$/)
  if (chronicleMatch) {
    const id = chronicleMatch[1]
    const raw = await env.CHRONICLES_KV.get(`inscriptions:${id}`, 'json') as SeoInscription
    if (!raw) return null
    return buildInscriptionHtml(id, raw)
  }

  // Rota: /wiki/collection/:slug
  const collectionMatch = pathname.match(/^\/wiki\/collection\/([^/]+)$/)
  if (collectionMatch && env.DB) {
    const slug = collectionMatch[1]
    const result = await env.DB.prepare(
      'SELECT title, summary FROM wiki_pages WHERE slug = ? AND entity_type = "collection"'
    ).bind(slug).first() as SeoCollection | null
    
    if (!result) return null
    return buildCollectionHtml(slug, result)
  }

  // Institutional static pages
  if (pathname === "/policies") {
    return buildStaticPageHtml(
      "Policies",
      "OrdinalMind privacy, BYOK handling, data integrity, and public-data policies.",
      "/policies"
    )
  }
  if (pathname === "/terms") {
    return buildStaticPageHtml(
      "Terms of Use",
      "Terms and conditions for using the OrdinalMind factual resolution engine.",
      "/terms"
    )
  }
  if (pathname === "/docs") return buildDocsHtml()

  return null
}

function buildStaticPageHtml(title: string, description: string, canonicalPath: string): string {
  const fullTitle = `${title} | OrdinalMind`
  return staticShell(
    `<main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>Please enable JavaScript to view the full interactive content of this page.</p>
  </main>`,
    {
      title: fullTitle,
      description,
      canonicalPath,
      twitterCard: "summary",
    }
  )
}

function buildHomeHtml(): string {
  const title = "OrdinalMind — Chronicle Memory Engine for Bitcoin Ordinals"
  const description = "Every inscription carries a story. OrdinalMind traces its journey — from inscription to current holder — through verifiable public data."

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "OrdinalMind",
    url: SITE_URL,
    description,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/chronicle/{identifier}`,
      "query-input": "required name=identifier",
    },
    sameAs: ["https://github.com/Lipe-lx/ordinal-mind"],
  }

  return staticShell(
    `<main>
    <header>
      <h1>OrdinalMind</h1>
      <p>Factual first memory engine for Bitcoin Ordinals.</p>
      <p>Resolve an inscription number, inscription ID, or Taproot address into a verifiable Chronicle built from public sources.</p>
    </header>
    <section aria-labelledby="home-inputs">
      <h2 id="home-inputs">Accepted Inputs</h2>
      <ul>
        <li>Inscription number, for example <code>69420</code>.</li>
        <li>Inscription ID in the form <code>64hex...i0</code>.</li>
        <li>Taproot address in the form <code>bc1p...</code>.</li>
      </ul>
    </section>
    <section aria-labelledby="home-sources">
      <h2 id="home-sources">Public Data Sources</h2>
      <p>OrdinalMind aggregates public, cacheable data from <code>ordinals.com</code>, <code>mempool.space</code>, and UniSat, then builds a deterministic chronology with explicit timestamps and source references.</p>
    </section>
    <section aria-labelledby="home-fallbacks">
      <h2 id="home-fallbacks">Fallback and BYOK Rules</h2>
      <p>The factual timeline is the core product and remains available without LLM access. Narrative synthesis is optional and runs client-side via BYOK adapters; the server does not receive or store user LLM API keys.</p>
    </section>
    <section aria-labelledby="home-agents">
      <h2 id="home-agents">Agent Surface</h2>
      <p>The public read-only agent surface is available at <a href="/mcp">/mcp</a>. OAuth is only required for authenticated actions such as community-governed wiki contributions.</p>
    </section>
    <section aria-labelledby="home-links">
      <h2 id="home-links">Public Machine-Readable Links</h2>
      <ul>
        <li><a href="/docs">Documentation</a></li>
        <li><a href="/llms.txt">llms.txt</a></li>
        <li><a href="/robots.txt">robots.txt</a></li>
        <li><a href="/sitemap.xml">sitemap.xml</a></li>
      </ul>
    </section>
  </main>`,
    {
      title,
      description,
      canonicalPath: "/",
      ogType: "website",
      twitterCard: "summary_large_image",
      jsonLd,
    }
  )
}

function buildDocsHtml(): string {
  const title = "Documentation | OrdinalMind"
  const description = "Product thesis, temporal tree, wiki atlas, BYOK policy, and MCP agent interface for OrdinalMind."

  return staticShell(
    `<main>
    <header>
      <h1>Documentation</h1>
      <p>OrdinalMind is a factual memory engine for Bitcoin Ordinals. The raw event tree is the product; narrative and wiki layers are additive.</p>
      <p>Source code: <a href="https://github.com/Lipe-lx/ordinal-mind">github.com/Lipe-lx/ordinal-mind</a></p>
    </header>
    <section aria-labelledby="docs-how">
      <h2 id="docs-how">How It Works</h2>
      <p>Resolution normalizes inscription numbers, inscription IDs, and Taproot addresses. Discovery gathers public on-chain and web references. Timeline construction merges, deduplicates, and sorts events chronologically. Consensus layers community-vetted wiki context. Synthesis is optional and client-side.</p>
    </section>
    <section aria-labelledby="docs-trust">
      <h2 id="docs-trust">Trust, Privacy, and BYOK</h2>
      <p>OrdinalMind uses Discord identity for community consensus, but the core timeline must not depend on identity or LLM success. User LLM keys stay in the browser and are never proxied through the server.</p>
    </section>
    <section aria-labelledby="docs-agent">
      <h2 id="docs-agent">Agent Layer (MCP)</h2>
      <p>The public MCP endpoint is <a href="/mcp">/mcp</a>. Anonymous access exposes read-only resources and tools. OAuth unlocks authenticated actions while keeping Discord tier and capability rules enforced.</p>
      <ul>
        <li><code>GET /api/chronicle?id=...</code> for public Chronicle resolution.</li>
        <li><code>GET /api/wiki/collection/{slug}/consolidated</code> for public consolidated wiki context.</li>
        <li><code>/mcp</code> for structured agent access.</li>
      </ul>
    </section>
  </main>`,
    {
      title,
      description,
      canonicalPath: "/docs",
      twitterCard: "summary",
    }
  )
}

function buildInscriptionHtml(id: string, data: SeoInscription): string {
  const collectionName = data.collection_id ?? "Unknown Collection"
  const title = `Inscription ${id.slice(0, 8)}... — ${collectionName} #${data.inscription_number} | OrdinalMind`
  const description = `Complete chronicle of ${collectionName} #${data.inscription_number}: inscribed in block ${data.genesis_block}, sat ${data.sat_rarity} rarity, verified on-chain events.`

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["CreativeWork", "DigitalDocument"],
    "@id": `https://ordinalmind.com/chronicle/${id}`,
    "name": `${collectionName} #${data.inscription_number}`,
    "identifier": { "@type": "PropertyValue", "propertyID": "ordinals_inscription_id", "value": id },
    "dateCreated": data.genesis_timestamp,
    "description": description,
    "isPartOf": {
      "@type": "CreativeWorkSeries",
      "@id": `https://ordinalmind.com/wiki/collection/${data.collection_id}`,
      "name": collectionName
    },
    "provider": { "@type": "Organization", "name": "OrdinalMind", "url": "https://ordinalmind.com" }
  }

  return staticShell(
    `<main>
    <h1>${escapeHtml(collectionName)} #${data.inscription_number}</h1>
    <p><strong>Inscription ID:</strong> ${escapeHtml(id)}</p>
    <p><strong>Block:</strong> ${data.genesis_block}</p>
    <p><strong>Sat Rarity:</strong> ${escapeHtml(data.sat_rarity)}</p>
  </main>`,
    {
      title,
      description,
      canonicalPath: `/chronicle/${encodeURIComponent(id)}`,
      ogType: "article",
      twitterCard: "summary_large_image",
      jsonLd,
    }
  )
}

function buildCollectionHtml(slug: string, data: SeoCollection): string {
  const title = `${data.title} — Ordinals Wiki | OrdinalMind`
  const description = data.summary ?? `${data.title} Verified provenance, community knowledge, and complete on-chain history.`
  
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["Collection", "CreativeWorkSeries"],
    "@id": `https://ordinalmind.com/wiki/collection/${slug}`,
    "name": data.title,
    "url": `https://ordinalmind.com/wiki/collection/${slug}`,
    "description": description,
    "provider": {
      "@type": "Organization",
      "name": "OrdinalMind",
      "url": "https://ordinalmind.com"
    }
  }

  return staticShell(
    `<main>
    <h1>${escapeHtml(data.title)}</h1>
    <p>${escapeHtml(data.summary ?? description)}</p>
  </main>`,
    {
      title,
      description,
      canonicalPath: `/wiki/collection/${encodeURIComponent(slug)}`,
      ogType: "article",
      twitterCard: "summary_large_image",
      jsonLd,
    }
  )
}
