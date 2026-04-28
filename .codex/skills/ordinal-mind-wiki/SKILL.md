---
name: ordinal-mind-wiki
description: >
  Implements the LLM Wiki pattern inside Ordinal Mind. Use this skill when the
  user asks to add a wiki, knowledge base, persistent memory, Chronicle wiki,
  chat with tools, or any feature that accumulates and queries knowledge about
  inscriptions, collections, artists, or sats across sessions. Covers the full
  three-layer architecture: immutable raw events (Layer 0), LLM-generated wiki
  pages (Layer 1), and BYOK chat with Worker-executed tools (Layer 2). Must be
  consulted before touching any of the following files or creating new ones
  related to wiki, knowledge, chat, or tools endpoints in the project.
---

# Ordinal Mind — LLM Wiki Implementation Skill

## Prime Directive

This skill implements the Karpathy LLM Wiki pattern adapted to Ordinal Mind's
"Factual First, Zero Custody" architecture. The core invariant that must never
be violated:

> **Every wiki claim must have at least one `source_event_id` that exists in
> the Layer 0 raw events store. A wiki claim without a traceable source is
> invalid and must be rejected or marked `unverified`.**

BYOK applies to Chronicle narratives AND to wiki page generation. The Worker
never calls an LLM using user keys. The Worker does validate and persist wiki
content after the client generates it.

---

## Architecture Overview

```
Layer 0 — Raw Events (Cloudflare D1: raw_chronicle_events)
  ↑ read-only for models
  ↓ written only by Worker agents (ordinals.ts, mempool.ts, unisat.ts, …)

Layer 1 — Wiki Pages (Cloudflare D1: wiki_pages + Cloudflare Vectorize)
  ↑ read by chat tools and wiki UI
  ↓ written by Worker /api/wiki/ingest after client-side BYOK generation
    → Worker validates source_event_ids before persisting

Layer 2 — BYOK Chat (client-side LLM + Worker tool endpoints)
  Tools execute in Worker (search_wiki, get_raw_events, get_timeline,
  get_collection_context) and return JSON to client
  LLM call stays in browser — same BYOK engine already in the project
```

New files and routes introduced by this skill:
- `src/worker/wiki/` — generator, tools, lint, ingest route
- `src/worker/routes/wiki.ts` — Worker route handler
- `src/app/components/WikiChat.tsx` — chat UI
- `src/app/lib/byok/wikiAdapter.ts` — BYOK adapter extension for wiki chat
- D1 migrations in `migrations/`

---

## Implementation Sequence

Follow this order. Do not skip ahead.

1. **Database** — provision D1 tables and Vectorize index (→ `references/db-schema.md`)
2. **Layer 0 persistence** — persist raw Chronicle events to D1 after each scan
3. **Ingest endpoint** — Worker validates and stores wiki pages from client
4. **Search tool** — Worker semantic search via Vectorize
5. **Chat tools** — expose remaining tools as REST endpoints
6. **BYOK wiki adapter** — extend existing BYOK engine for wiki chat
7. **WikiChat UI** — replace static narrative section with interactive chat
8. **Lint job** — periodic integrity check (→ `references/lint-ops.md`)

---

## Layer 0 — Raw Events Persistence

### When to write

After the Timeline Builder completes in `index.ts`, persist events to D1 before
returning the SSE `done` event. This is a fire-and-forget write — do not block
the SSE response on it.

```typescript
// src/worker/wiki/persistEvents.ts
export async function persistRawEvents(
  env: Env,
  inscriptionId: string,
  events: ChronicleEvent[]
): Promise<void> {
  const stmt = env.DB.prepare(`
    INSERT OR IGNORE INTO raw_chronicle_events
      (id, inscription_id, event_type, timestamp, block_height,
       source_type, source_ref, description, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const batch = events.map(e =>
    stmt.bind(
      e.id, inscriptionId, e.event_type, e.timestamp,
      e.block_height ?? null, e.source.type, e.source.ref,
      e.description, JSON.stringify(e.metadata ?? {})
    )
  );
  await env.DB.batch(batch);
}
```

**Rules:**
- Use `INSERT OR IGNORE` — events are immutable, never update them
- The `id` field on `ChronicleEvent` must be stable and deterministic (already required by `timeline.ts`)
- Never call this function from client-side code

---

## Layer 1 — Wiki Generation (client-side BYOK)

### Wiki page types

| slug pattern | entity | example |
|---|---|---|
| `inscription:{id}` | single inscription | `inscription:abc123...i0` |
| `collection:{slug}` | collection | `collection:bitcoin-frogs` |
| `artist:{handle}` | artist/creator | `artist:xverso` |
| `sat:{sat_number}` | notable sat | `sat:2099994130` |

### Client-side generation flow

1. User finishes viewing a Chronicle (events already fetched and in state)
2. If user has BYOK configured, `wikiAdapter.ts` checks if a wiki page exists
   for this inscription via `GET /api/wiki/:slug`
3. If missing or stale (> 7 days), prompt model with the raw events JSON +
   system instructions from `WIKI_SYSTEM_PROMPT` (see below)
4. Model returns a structured `WikiPageDraft` (see schema below)
5. Client POSTs draft to `POST /api/wiki/ingest`
6. Worker validates all `source_event_ids` exist in D1, rejects or persists

### `WIKI_SYSTEM_PROMPT` (embed in `wikiAdapter.ts`)

```
You are a factual wiki writer for Bitcoin Ordinals. You will receive raw
Chronicle events for an inscription. Write a structured wiki page.

RULES:
- Every claim must cite a source_event_id from the provided events array.
- Do not invent events, dates, prices, rarity rankings, or collection data.
- Do not write narrative hype. Write factual encyclopedia prose.
- If a fact cannot be traced to a source_event_id, omit it.
- Keep descriptions under 3 sentences per section.
- Cross-reference slugs: if you mention a collection, output its slug.

OUTPUT FORMAT: Return only valid JSON matching the WikiPageDraft schema.
No markdown, no prose outside the JSON.
```

### `WikiPageDraft` schema

```typescript
interface WikiPageDraft {
  slug: string;                    // e.g. "inscription:abc123i0"
  entity_type: "inscription" | "collection" | "artist" | "sat";
  title: string;                   // e.g. "#847,293"
  summary: string;                 // 1-2 sentences, factual only
  sections: WikiSection[];
  cross_refs: string[];            // slugs of related entities
  source_event_ids: string[];      // ALL event IDs used across all sections
  generated_at: string;            // ISO timestamp
  byok_provider: string;           // "anthropic" | "openai" | "gemini"
}

interface WikiSection {
  heading: string;
  body: string;
  source_event_ids: string[];      // subset of page-level source_event_ids
}
```

### Ingest endpoint validation (Worker)

```typescript
// src/worker/wiki/ingest.ts
export async function handleIngest(req: Request, env: Env): Promise<Response> {
  const draft: WikiPageDraft = await req.json();

  // 1. Validate source_event_ids exist in Layer 0
  const ids = draft.source_event_ids;
  if (ids.length === 0) {
    return new Response("No source_event_ids — rejected", { status: 422 });
  }
  const placeholders = ids.map(() => "?").join(",");
  const found = await env.DB.prepare(
    `SELECT id FROM raw_chronicle_events WHERE id IN (${placeholders})`
  ).bind(...ids).all();

  const foundSet = new Set(found.results.map((r: any) => r.id));
  const unverified = ids.filter(id => !foundSet.has(id));

  // 2. If any IDs are unverified, mark sections accordingly
  if (unverified.length > 0) {
    draft.sections = draft.sections.map(s => ({
      ...s,
      source_event_ids: s.source_event_ids.filter(id => foundSet.has(id)),
      unverified_claims: s.source_event_ids.filter(id => !foundSet.has(id)).length > 0,
    }));
  }

  // 3. Upsert into D1 (FTS index is updated automatically via trigger — see db-schema.md)
  await env.DB.prepare(`
    INSERT INTO wiki_pages
      (slug, entity_type, title, summary, sections_json, cross_refs_json,
       source_event_ids_json, generated_at, byok_provider, unverified_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title=excluded.title, summary=excluded.summary,
      sections_json=excluded.sections_json, cross_refs_json=excluded.cross_refs_json,
      source_event_ids_json=excluded.source_event_ids_json,
      generated_at=excluded.generated_at, byok_provider=excluded.byok_provider,
      unverified_count=excluded.unverified_count
  `).bind(
    draft.slug, draft.entity_type, draft.title, draft.summary,
    JSON.stringify(draft.sections), JSON.stringify(draft.cross_refs),
    JSON.stringify(draft.source_event_ids), draft.generated_at,
    draft.byok_provider, unverified.length
  ).run();

  return Response.json({ ok: true, unverified_count: unverified.length });
}
```

Search is handled by D1 FTS5 (SQLite full-text search built into D1 — zero cost,
zero external dependency). See `references/db-schema.md` for the FTS virtual table
and `references/chat-tools.md` for the `search_wiki` query pattern.

---

## Layer 2 — Chat Tools (Worker endpoints)

The client passes tool definitions to the BYOK LLM. When the model calls a tool,
the client POSTs to the Worker tool endpoint, receives the result, and continues
inference. The LLM call itself never leaves the browser.

See **`references/chat-tools.md`** for the full implementation of each tool:
- `search_wiki` — D1 FTS5 full-text search → ranked wiki pages (BM25, zero cost)
- `get_raw_events` — returns Layer 0 events for an inscription ID or address
- `get_timeline` — returns the rendered timeline (reuses existing cache)
- `get_collection_context` — returns collection wiki page + child count

### Tool call loop pattern (in `wikiAdapter.ts`)

```typescript
async function runChatTurn(
  userMessage: string,
  history: Message[],
  env: { apiKey: string; provider: string }
): Promise<string> {
  let messages = [...history, { role: "user", content: userMessage }];

  while (true) {
    const response = await callBYOK(messages, TOOLS, env);

    if (response.stop_reason === "tool_use") {
      const toolResults = await Promise.all(
        response.tool_calls.map(tc => executeToolViaWorker(tc))
      );
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults }
      ];
      continue;
    }

    return extractText(response);
  }
}

async function executeToolViaWorker(toolCall: ToolCall): Promise<ToolResult> {
  const res = await fetch(`/api/wiki/tools/${toolCall.name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toolCall.input)
  });
  return { tool_use_id: toolCall.id, content: await res.text() };
}
```

---

## WikiChat UI Integration

Replace the static narrative `<div>` in `Chronicle.tsx` with `<WikiChat>`.
The component has two modes controlled by a tab: **Timeline** (existing
`TemporalTree`) and **Ask** (the new chat).

```typescript
// src/app/components/WikiChat.tsx
// Props: inscriptionId, events (ChronicleEvent[]), byokConfig
// State: messages[], isLoading, wikiPage (WikiPageDraft | null)

// On mount: fetch GET /api/wiki/inscription:{id}
//   → if found, show summary card above chat input
//   → if not found and BYOK is configured, trigger generation
// On generation complete: POST /api/wiki/ingest, update local state
```

See **`references/wiki-ui.md`** for full component skeleton and CSS variables.

---

## New Files Summary

```
migrations/
  0001_raw_chronicle_events.sql
  0002_wiki_pages.sql

src/worker/
  wiki/
    persistEvents.ts      ← Layer 0 write after each scan
    ingest.ts             ← POST /api/wiki/ingest (validates + persists)
    tools.ts              ← POST /api/wiki/tools/* handlers (FTS5 search, raw events)
    lint.ts               ← integrity checker (client-triggered, on-demand)
  routes/
    wiki.ts               ← route multiplexer for /api/wiki/*

src/app/
  components/
    WikiChat.tsx          ← chat UI + wiki page summary card
  lib/
    byok/
      wikiAdapter.ts      ← tool-loop BYOK adapter for wiki chat
    wikiTypes.ts          ← WikiPageDraft, WikiSection interfaces
```

---

## wrangler.jsonc additions

Only one new binding is required — Cloudflare D1. No AI, no Vectorize, no new
paid services. All intelligence stays client-side.

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "ordinal-mind-wiki",
      "database_id": "<run: wrangler d1 create ordinal-mind-wiki>"
    }
  ]
}
```

Create the database and apply migrations:
```bash
wrangler d1 create ordinal-mind-wiki
wrangler d1 execute ordinal-mind-wiki --file=migrations/0001_raw_chronicle_events.sql
wrangler d1 execute ordinal-mind-wiki --file=migrations/0002_wiki_pages.sql
```

---

## AGENTS.md Compliance Checklist

Before considering any implementation complete, verify:

- [ ] No user LLM API keys sent to Worker at any point
- [ ] `raw_chronicle_events` table has no UPDATE or DELETE paths
- [ ] `POST /api/wiki/ingest` validates all `source_event_ids` before persisting
- [ ] Failed wiki generation does not block the existing Chronicle experience
- [ ] `GET /api/wiki/:slug` returns 404 gracefully (no 500s)
- [ ] Tool endpoints return partial results on upstream failure, not empty errors
- [ ] No server-side LLM calls of any kind (generation, embeddings, lint analysis)
- [ ] No new paid API or billing surface introduced (D1 is included in Workers free tier)
- [ ] `unverified_count > 0` pages are visually marked in the UI
- [ ] Lint is triggered client-side only — no Cron Triggers, no scheduled Workers

---

## Reference Files

Read these when implementing the corresponding step:

| File | Read when |
|---|---|
| `references/db-schema.md` | Setting up D1 tables and FTS5 full-text search index |
| `references/chat-tools.md` | Implementing Worker tool endpoints |
| `references/lint-ops.md` | Building the wiki integrity checker |
