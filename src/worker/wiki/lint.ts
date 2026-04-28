import type { Env } from "../index"
import type { WikiLintReport } from "./types"

export async function runWikiLint(env: Env): Promise<WikiLintReport> {
  if (!env.DB) {
    return {
      run_at: new Date().toISOString(),
      unverified_pages: [],
      orphan_pages: [],
      stale_pages: [],
      broken_cross_refs: [],
      summary: { total: 0, healthy: 0, needs_attention: 0 },
    }
  }

  const [unverified, orphan, stale, allPages] = await Promise.all([
    env.DB.prepare(`
      SELECT slug, title, unverified_count
      FROM wiki_pages
      WHERE unverified_count > 0
      ORDER BY unverified_count DESC
      LIMIT 100
    `).all<{ slug: string; title: string; unverified_count: number }>(),
    env.DB.prepare(`
      SELECT wp.slug, wp.title
      FROM wiki_pages wp
      WHERE wp.entity_type = 'inscription'
        AND NOT EXISTS (
          SELECT 1 FROM raw_chronicle_events rce
          WHERE 'inscription:' || rce.inscription_id = wp.slug
        )
      LIMIT 100
    `).all<{ slug: string; title: string }>(),
    env.DB.prepare(`
      SELECT slug, generated_at
      FROM wiki_pages
      WHERE generated_at < datetime('now', '-30 days')
      ORDER BY generated_at ASC
      LIMIT 100
    `).all<{ slug: string; generated_at: string }>(),
    env.DB.prepare(`
      SELECT slug, cross_refs_json
      FROM wiki_pages
    `).all<{ slug: string; cross_refs_json: string }>(),
  ])

  const brokenCrossRefs = await collectBrokenCrossRefs(allPages.results ?? [], env)

  const needsAttention = new Set<string>([
    ...(unverified.results ?? []).map((item) => item.slug),
    ...(orphan.results ?? []).map((item) => item.slug),
    ...(stale.results ?? []).map((item) => item.slug),
    ...brokenCrossRefs.map((item) => item.slug),
  ])

  const total = (allPages.results ?? []).length

  const report: WikiLintReport = {
    run_at: new Date().toISOString(),
    unverified_pages: unverified.results ?? [],
    orphan_pages: orphan.results ?? [],
    stale_pages: stale.results ?? [],
    broken_cross_refs: brokenCrossRefs,
    summary: {
      total,
      healthy: Math.max(0, total - needsAttention.size),
      needs_attention: needsAttention.size,
    },
  }

  await env.DB.prepare(`
    INSERT INTO wiki_log (operation, detail_json)
    VALUES ('lint', ?)
  `)
    .bind(JSON.stringify(report.summary))
    .run()

  return report
}

async function collectBrokenCrossRefs(
  pages: Array<{ slug: string; cross_refs_json: string }>,
  env: Env
): Promise<Array<{ slug: string; broken_ref: string }>> {
  if (!env.DB) return []

  const broken: Array<{ slug: string; broken_ref: string }> = []

  for (const page of pages) {
    const refs = parseCrossRefs(page.cross_refs_json)

    for (const ref of refs) {
      const exists = await env.DB.prepare(
        `SELECT 1 as exists_flag FROM wiki_pages WHERE slug = ? LIMIT 1`
      )
        .bind(ref)
        .first<{ exists_flag: number }>()

      if (!exists) {
        broken.push({ slug: page.slug, broken_ref: ref })
      }
    }
  }

  return broken
}

function parseCrossRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}
