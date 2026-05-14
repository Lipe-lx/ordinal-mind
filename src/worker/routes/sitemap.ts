import type { Env } from "../index"

export async function handleSitemapRoute(env: Env): Promise<Response> {
  const entries = new Map<string, { priority: string; changefreq: string }>()

  function addEntry(pathname: string, priority: string, changefreq: string) {
    const url = `https://ordinalmind.com${pathname}`
    if (entries.has(url)) return
    entries.set(url, { priority, changefreq })
  }

  addEntry("/", "1.0", "daily")
  addEntry("/docs", "0.9", "weekly")
  addEntry("/terms", "0.4", "monthly")
  addEntry("/policies", "0.4", "monthly")
  addEntry("/wiki/collections", "0.9", "daily")

  if (env.DB) {
    try {
      const result = await env.DB.prepare(
        "SELECT slug, entity_type FROM wiki_pages LIMIT 1000"
      ).all<{ slug: string; entity_type: string }>()

      if (result.results) {
        for (const row of result.results) {
          let priority = "0.7"
          let prefix = "wiki/page/"
          let changefreq = "weekly"
          const rawSlug = row.slug.replace(/^(collection|inscription):/, "")
          const isInscriptionId = /^[a-f0-9]{64}i\d+$/i.test(rawSlug)

          if (row.entity_type === "collection" || row.slug.startsWith("collection:")) {
            if (isInscriptionId) continue
            priority = "0.9"
            prefix = "wiki/collection/"
            changefreq = "daily"
          } else if (row.entity_type === "inscription" || row.slug.startsWith("inscription:")) {
            priority = "0.7"
            prefix = "wiki/inscription/"
          } else if (row.entity_type === "artist") {
            priority = "0.8"
            prefix = "wiki/artist/"
          }

          addEntry(`/${prefix}${encodeURIComponent(rawSlug)}`, priority, changefreq)

          if (row.entity_type === "inscription" || row.slug.startsWith("inscription:")) {
            addEntry(`/chronicle/${encodeURIComponent(rawSlug)}`, "0.6", "never")
          }
        }
      }
    } catch (e) {
      console.error("Sitemap DB error:", e)
    }
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`

  for (const [loc, meta] of entries) {
    xml += `
  <url>
    <loc>${loc}</loc>
    <priority>${meta.priority}</priority>
    <changefreq>${meta.changefreq}</changefreq>
  </url>`
  }

  xml += `
</urlset>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
