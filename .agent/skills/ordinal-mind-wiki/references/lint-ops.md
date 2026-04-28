# Lint Operations Reference — Ordinal Mind Wiki

The wiki lint operation is an integrity health-check that runs periodically or
on-demand. It detects: unverified claims, orphan pages, stale pages, and missing
cross-references.

---

## Lint endpoint — `GET /api/wiki/lint`

Trigger manually (dev) or via a Cloudflare Cron Trigger (prod).

```typescript
// src/worker/wiki/lint.ts

export interface LintReport {
  run_at: string;
  unverified_pages: { slug: string; title: string; unverified_count: number }[];
  orphan_pages: { slug: string; title: string }[];       // no raw events in Layer 0
  stale_pages: { slug: string; generated_at: string }[]; // older than 30 days
  broken_cross_refs: { slug: string; broken_ref: string }[];
  summary: { total: number; healthy: number; needs_attention: number };
}

export async function runLint(env: Env): Promise<LintReport> {
  const [unverified, orphans, stale, allPages] = await Promise.all([
    getUnverifiedPages(env),
    getOrphanPages(env),
    getStalePages(env),
    getAllPages(env)
  ]);

  const broken = await getBrokenCrossRefs(allPages, env);

  const needsAttention = new Set([
    ...unverified.map(p => p.slug),
    ...orphans.map(p => p.slug),
    ...stale.map(p => p.slug),
    ...broken.map(p => p.slug)
  ]).size;

  const report: LintReport = {
    run_at: new Date().toISOString(),
    unverified_pages: unverified,
    orphan_pages: orphans,
    stale_pages: stale,
    broken_cross_refs: broken,
    summary: {
      total: allPages.length,
      healthy: allPages.length - needsAttention,
      needs_attention: needsAttention
    }
  };

  // Log the lint run
  await env.DB.prepare(`
    INSERT INTO wiki_log (operation, detail_json)
    VALUES ('lint', ?)
  `).bind(JSON.stringify(report.summary)).run();

  return report;
}

async function getUnverifiedPages(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT slug, title, unverified_count
    FROM wiki_pages
    WHERE unverified_count > 0
    ORDER BY unverified_count DESC
    LIMIT 100
  `).all();
  return rows.results as any[];
}

async function getOrphanPages(env: Env) {
  // Pages whose source_event_ids have NO match in raw_chronicle_events
  // (the inscription was never scanned or was purged)
  const rows = await env.DB.prepare(`
    SELECT wp.slug, wp.title
    FROM wiki_pages wp
    WHERE wp.entity_type = 'inscription'
      AND NOT EXISTS (
        SELECT 1 FROM raw_chronicle_events rce
        WHERE 'inscription:' || rce.inscription_id = wp.slug
      )
    LIMIT 100
  `).all();
  return rows.results as any[];
}

async function getStalePages(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT slug, generated_at
    FROM wiki_pages
    WHERE generated_at < datetime('now', '-30 days')
    ORDER BY generated_at ASC
    LIMIT 100
  `).all();
  return rows.results as any[];
}

async function getAllPages(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT slug, cross_refs_json FROM wiki_pages
  `).all();
  return rows.results as any[];
}

async function getBrokenCrossRefs(pages: any[], env: Env) {
  const broken: { slug: string; broken_ref: string }[] = [];
  for (const page of pages) {
    const refs: string[] = JSON.parse(page.cross_refs_json ?? "[]");
    for (const ref of refs) {
      const exists = await env.DB.prepare(
        "SELECT 1 FROM wiki_pages WHERE slug = ? LIMIT 1"
      ).bind(ref).first();
      if (!exists) broken.push({ slug: page.slug, broken_ref: ref });
    }
  }
  return broken;
}
```

---

## Cron Trigger Setup (wrangler.jsonc)

```jsonc
{
  "triggers": {
    "crons": ["0 3 * * *"]   // daily at 03:00 UTC
  }
}
```

In `src/worker/index.ts`:
```typescript
export default {
  async fetch(req: Request, env: Env) { /* existing */ },

  async scheduled(_event: ScheduledEvent, env: Env) {
    const report = await runLint(env);
    // Optionally: POST report to a webhook or store in KV for admin UI
    await env.KV.put("wiki:lint:latest", JSON.stringify(report), {
      expirationTtl: 60 * 60 * 24 * 7  // keep for 7 days
    });
  }
};
```

---

## On-Demand Lint (dev/admin)

```typescript
// In handleWikiRoute:
if (req.method === "GET" && path === "/api/wiki/lint") {
  // Optional: add a secret header check for security
  const report = await runLint(env);
  return Response.json(report);
}
```

---

## Re-generation Signal

The lint report tells you WHICH pages need work. It does NOT auto-regenerate them
(that would require server-side LLM). Instead:

1. The lint report is stored in KV as `wiki:lint:latest`
2. When a user opens a Chronicle page, the client checks if that inscription's
   wiki slug appears in the lint report (fetched once per session)
3. If stale or unverified, the BYOK adapter triggers re-generation automatically
   (same flow as first-time generation)

This preserves the BYOK constraint: re-generation is always user-initiated and
client-side.

---

## Integrity invariant check (run in CI / smoke tests)

```typescript
// tests/worker/wikiIntegrity.test.ts
it("all wiki source_event_ids exist in Layer 0", async () => {
  const pages = await env.DB.prepare("SELECT slug, source_event_ids_json FROM wiki_pages").all();
  for (const page of pages.results) {
    const ids: string[] = JSON.parse(page.source_event_ids_json);
    for (const id of ids) {
      const exists = await env.DB.prepare(
        "SELECT 1 FROM raw_chronicle_events WHERE id = ?"
      ).bind(id).first();
      expect(exists, `Page ${page.slug} references unknown event ${id}`).toBeTruthy();
    }
  }
});
```

Add to `npm run test:smoke`.
