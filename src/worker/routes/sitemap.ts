import type { Env } from "../index"

export async function handleSitemapRoute(env: Env): Promise<Response> {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ordinalmind.com/</loc>
    <priority>1.0</priority>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>https://ordinalmind.com/wiki/collections</loc>
    <priority>0.9</priority>
    <changefreq>daily</changefreq>
  </url>`

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

          if (row.entity_type === "collection" || row.slug.startsWith("collection:")) {
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
          
          xml += `
  <url>
    <loc>https://ordinalmind.com/${prefix}${encodeURIComponent(rawSlug)}</loc>
    <priority>${priority}</priority>
    <changefreq>${changefreq}</changefreq>
  </url>`

          if (row.entity_type === "inscription" || row.slug.startsWith("inscription:")) {
            xml += `
  <url>
    <loc>https://ordinalmind.com/chronicle/${encodeURIComponent(rawSlug)}</loc>
    <priority>0.6</priority>
    <changefreq>never</changefreq>
  </url>`
          }
        }
      }
    } catch (e) {
      console.error("Sitemap DB error:", e)
    }
  }

  xml += `\n</urlset>`

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
