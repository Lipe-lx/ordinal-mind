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

## Client-Side Triggering (no Cron, no scheduled Workers)

Lint runs **on-demand only**, triggered by the browser. No server-side scheduled
jobs, no Cron Triggers, no billing surface.

### Trigger strategy

The client checks once per browser session whether a lint run is needed:

```typescript
// src/app/lib/wikiLint.ts

const LINT_SESSION_KEY = "ordinal-mind:wiki-lint-checked";
const LINT_STALE_AFTER_MS = 12 * 60 * 60 * 1000; // 12 hours

export async function maybeRunLint(): Promise<void> {
  const last = sessionStorage.getItem(LINT_SESSION_KEY);
  if (last && Date.now() - Number(last) < LINT_STALE_AFTER_MS) return;

  try {
    await fetch("/api/wiki/lint", { method: "GET", priority: "low" });
    sessionStorage.setItem(LINT_SESSION_KEY, String(Date.now()));
  } catch {
    // Lint failure is silent — never blocks the user
  }
}
```

Call `maybeRunLint()` inside `WikiChat.tsx` after the component mounts, using
`requestIdleCallback` so it never competes with UI rendering:

```typescript
useEffect(() => {
  const id = requestIdleCallback(() => { maybeRunLint(); });
  return () => cancelIdleCallback(id);
}, []);
```

### `GET /api/wiki/lint` endpoint

The lint endpoint is lightweight — it only reads D1, no LLM calls, no writes
except the `wiki_log` entry. Execution time is well within Worker CPU limits.

```typescript
// In handleWikiRoute (src/worker/routes/wiki.ts):
if (req.method === "GET" && path === "/api/wiki/lint") {
  const report = await runLint(env);
  return Response.json(report);
}
```

**Security note:** The lint endpoint exposes no sensitive data (only slugs,
counts, and timestamps of public wiki content). No auth header required.
If you want to prevent public enumeration of wiki slugs, add a simple
`X-Lint-Token` header check using a KV-stored secret.

---

## Re-generation Signal

The lint report tells you WHICH pages need work. It does NOT auto-regenerate them
(that requires an LLM — stays client-side). Instead:

1. The lint JSON is returned directly to the browser that triggered it
2. The client stores the report in `sessionStorage` as `ordinal-mind:wiki-lint-report`
3. When a user opens any Chronicle page, `WikiChat.tsx` checks if that inscription's
   slug appears in the lint report (stale or unverified)
4. If flagged, the BYOK adapter triggers re-generation automatically using the
   user's own key — same flow as first-time generation
5. On successful re-ingest, the slug is removed from the in-memory lint report

This keeps the full loop: detect (Worker D1 query) → signal (JSON to client) →
re-generate (BYOK in browser) → persist (Worker validates + writes D1). The
server only executes deterministic reads and validated writes — never inference.

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
