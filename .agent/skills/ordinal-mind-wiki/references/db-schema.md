# DB Schema Reference — Ordinal Mind Wiki

## D1 Migrations

### `migrations/0001_raw_chronicle_events.sql`

```sql
CREATE TABLE IF NOT EXISTS raw_chronicle_events (
  id                TEXT PRIMARY KEY,      -- deterministic ChronicleEvent.id
  inscription_id    TEXT NOT NULL,
  event_type        TEXT NOT NULL,         -- genesis | transfer | sale | social_mention | …
  timestamp         TEXT,                  -- ISO 8601, nullable (unconfirmed)
  block_height      INTEGER,               -- nullable for off-chain events
  source_type       TEXT NOT NULL,         -- onchain | web
  source_ref        TEXT NOT NULL,         -- TXID, URL, etc.
  description       TEXT NOT NULL,
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rce_inscription ON raw_chronicle_events(inscription_id);
CREATE INDEX IF NOT EXISTS idx_rce_event_type  ON raw_chronicle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rce_timestamp   ON raw_chronicle_events(timestamp);
```

**Rules enforced by schema:**
- No `UPDATE` trigger — events are immutable by design
- `INSERT OR IGNORE` is the only valid write pattern
- All Worker agents write through `persistEvents.ts`, never directly

---

### `migrations/0002_wiki_pages.sql`

```sql
CREATE TABLE IF NOT EXISTS wiki_pages (
  slug                  TEXT PRIMARY KEY,    -- inscription:{id} | collection:{slug} | …
  entity_type           TEXT NOT NULL,       -- inscription | collection | artist | sat
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  sections_json         TEXT NOT NULL DEFAULT '[]',
  cross_refs_json       TEXT NOT NULL DEFAULT '[]',
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  generated_at          TEXT NOT NULL,
  byok_provider         TEXT NOT NULL,       -- anthropic | openai | gemini | openrouter
  unverified_count      INTEGER NOT NULL DEFAULT 0,
  view_count            INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,    -- ingest | lint | query
  slug        TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ts          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wp_entity_type ON wiki_pages(entity_type);
CREATE INDEX IF NOT EXISTS idx_wp_generated   ON wiki_pages(generated_at);
CREATE INDEX IF NOT EXISTS idx_wp_unverified  ON wiki_pages(unverified_count);
CREATE INDEX IF NOT EXISTS idx_wl_ts          ON wiki_log(ts);
```

---

## Cloudflare Vectorize Index

**Index name:** `ordinal-mind-wiki`  
**Dimensions:** 384 (matches `@cf/baai/bge-small-en-v1.5`)  
**Metric:** cosine

Create once:
```bash
wrangler vectorize create ordinal-mind-wiki --dimensions=384 --metric=cosine
```

Each `wiki_pages` row has a corresponding vector where:
- `id` = `slug`
- `values` = embedding of `title + " " + summary`
- `metadata` = `{ slug, entity_type, title }`

### Embedding utility

```typescript
// src/worker/wiki/embed.ts
export async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
    text: [text.slice(0, 512)]   // model max input
  });
  return result.data[0];
}
```

---

## Env interface additions (`src/worker/types.ts` or wherever `Env` is defined)

```typescript
interface Env {
  // existing
  KV: KVNamespace;
  // new
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
}
```

---

## Useful D1 query patterns

### Check if wiki page is fresh (< 7 days)

```typescript
const row = await env.DB.prepare(`
  SELECT slug, summary, updated_at, unverified_count
  FROM wiki_pages
  WHERE slug = ?
    AND updated_at > datetime('now', '-7 days')
`).bind(slug).first();
```

### Get all inscriptions without a wiki page (for bulk generation hints)

```typescript
const missing = await env.DB.prepare(`
  SELECT DISTINCT inscription_id
  FROM raw_chronicle_events
  WHERE 'inscription:' || inscription_id NOT IN (SELECT slug FROM wiki_pages)
  LIMIT 50
`).all();
```

### Lint: find wiki pages with unverified claims

```typescript
const unverified = await env.DB.prepare(`
  SELECT slug, title, unverified_count, generated_at
  FROM wiki_pages
  WHERE unverified_count > 0
  ORDER BY unverified_count DESC
  LIMIT 100
`).all();
```

### Log an operation

```typescript
await env.DB.prepare(`
  INSERT INTO wiki_log (operation, slug, detail_json)
  VALUES (?, ?, ?)
`).bind("ingest", slug, JSON.stringify({ provider: byokProvider, sections: n })).run();
```
