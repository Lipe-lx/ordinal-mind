const ROBOTS_TXT = `User-agent: *
Allow: /
Allow: /api/wiki/
Disallow: /api/auth/
Disallow: /mcp/oauth/

User-agent: GPTBot
Allow: /
Disallow: /api/auth/
Disallow: /mcp/oauth/

User-agent: ClaudeBot
Allow: /
Disallow: /api/auth/
Disallow: /mcp/oauth/

User-agent: Claude-Web
Allow: /
Disallow: /api/auth/
Disallow: /mcp/oauth/

User-agent: PerplexityBot
Allow: /
Disallow: /api/auth/
Disallow: /mcp/oauth/

Sitemap: https://ordinalmind.com/sitemap.xml
`

export function handleRobotsRoute(): Response {
  return new Response(ROBOTS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
