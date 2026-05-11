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

async function generateStaticHtml(pathname: string, env: Env): Promise<string | null> {
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

  // Rotas estáticas institucionais
  if (pathname === '/policies') return buildStaticPageHtml('Policies', 'OrdinalMind privacy, BYOK handling, and data integrity policies.')
  if (pathname === '/terms') return buildStaticPageHtml('Terms of Use', 'Terms and conditions for using the OrdinalMind factual resolution engine.')
  if (pathname === '/docs') return buildStaticPageHtml('Documentation', 'Complete documentation for OrdinalMind: Temporal Tree, Wiki Atlas, and Agent Layer (MCP). Source code available at github.com/Lipe-lx/ordinal-mind.')

  return null
}

function buildStaticPageHtml(title: string, description: string): string {
  const fullTitle = `${title} | OrdinalMind`
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta name="twitter:card" content="summary">
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <p>Please enable JavaScript to view the full interactive content of this page.</p>
  </main>
  <div id="root"></div>
  <script type="module" src="/src/app/main.tsx"></script>
</body>
</html>`
}

function buildInscriptionHtml(id: string, data: SeoInscription): string {
  const collectionName = data.collection_id ?? "Unknown Collection"
  const title = `Inscription ${id.slice(0, 8)}... — ${collectionName} #${data.inscription_number} | OrdinalMind`
  const description = `Complete chronicle of ${collectionName} #${data.inscription_number}: inscribed in block ${data.genesis_block}, sat ${data.sat_rarity} rarity, verified on-chain events.`

  const jsonLd = JSON.stringify({
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
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://ordinalmind.com/chronicle/${id}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="https://ordinalmind.com/chronicle/${id}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <main>
    <h1>${collectionName} #${data.inscription_number}</h1>
    <p><strong>Inscription ID:</strong> ${id}</p>
    <p><strong>Block:</strong> ${data.genesis_block}</p>
    <p><strong>Sat Rarity:</strong> ${data.sat_rarity}</p>
  </main>
  <div id="root"></div>
  <script type="module" src="/src/app/main.tsx"></script>
</body>
</html>`
}

function buildCollectionHtml(slug: string, data: SeoCollection): string {
  const title = `${data.title} — Ordinals Wiki | OrdinalMind`
  const description = data.summary ?? `${data.title} Verified provenance, community knowledge, and complete on-chain history.`
  
  const jsonLd = JSON.stringify({
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
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://ordinalmind.com/wiki/collection/${slug}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="https://ordinalmind.com/wiki/collection/${slug}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <main>
    <h1>${data.title}</h1>
    <p>${data.summary}</p>
  </main>
  <div id="root"></div>
  <script type="module" src="/src/app/main.tsx"></script>
</body>
</html>`
}
