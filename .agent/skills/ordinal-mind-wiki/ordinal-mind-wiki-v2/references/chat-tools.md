# Chat Tools Reference — Ordinal Mind Wiki

Worker-side tool endpoint implementations. All live under `/api/wiki/tools/:name`.
These are called by the client during the BYOK tool-use loop. They return JSON.

---

## Route Multiplexer — `src/worker/routes/wiki.ts`

```typescript
import { handleIngest } from "../wiki/ingest";
import { handleTools } from "../wiki/tools";

export async function handleWikiRoute(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;                // /api/wiki/…

  // GET /api/wiki/:slug — fetch a single page
  if (req.method === "GET" && path.startsWith("/api/wiki/") && !path.includes("/tools")) {
    const slug = decodeURIComponent(path.replace("/api/wiki/", ""));
    const row = await env.DB.prepare(
      "SELECT * FROM wiki_pages WHERE slug = ?"
    ).bind(slug).first();
    if (!row) return new Response(null, { status: 404 });
    // increment view_count fire-and-forget
    env.DB.prepare("UPDATE wiki_pages SET view_count = view_count + 1 WHERE slug = ?")
      .bind(slug).run();
    return Response.json(row);
  }

  // POST /api/wiki/ingest
  if (req.method === "POST" && path === "/api/wiki/ingest") {
    return handleIngest(req, env);
  }

  // POST /api/wiki/tools/:name
  if (req.method === "POST" && path.startsWith("/api/wiki/tools/")) {
    const toolName = path.replace("/api/wiki/tools/", "");
    return handleTools(toolName, req, env);
  }

  return new Response("Not found", { status: 404 });
}
```

Register in `src/worker/index.ts`:
```typescript
if (url.pathname.startsWith("/api/wiki")) {
  return handleWikiRoute(request, env);
}
```

---

## Tools Implementation — `src/worker/wiki/tools.ts`

```typescript
export async function handleTools(
  name: string, req: Request, env: Env
): Promise<Response> {
  const input = await req.json();
  const cors = { "Access-Control-Allow-Origin": "*" };

  try {
    switch (name) {
      case "search_wiki":       return Response.json(await searchWiki(input, env), { headers: cors });
      case "get_raw_events":    return Response.json(await getRawEvents(input, env), { headers: cors });
      case "get_timeline":      return Response.json(await getTimeline(input, env), { headers: cors });
      case "get_collection":    return Response.json(await getCollectionContext(input, env), { headers: cors });
      default:                  return new Response("Unknown tool", { status: 404 });
    }
  } catch (err) {
    // Graceful degradation: return partial failure, not 500
    return Response.json({ error: String(err), partial: true }, { status: 200, headers: cors });
  }
}
```

---

## Tool: `search_wiki`

BM25 full-text search over wiki pages via D1 FTS5. Zero external cost — runs
entirely inside the D1 SQLite engine on the Worker.

**Input:**
```typescript
{ query: string; limit?: number; entity_type?: string }
```

**Implementation:**
```typescript
async function searchWiki(
  input: { query: string; limit?: number; entity_type?: string },
  env: Env
) {
  const limit = Math.min(input.limit ?? 5, 10);
  const typeClause = input.entity_type
    ? `AND wp.entity_type = '${input.entity_type}'`
    : "";

  // Sanitize: strip FTS5 special chars, add prefix wildcard
  const q = input.query.replace(/['"*^()]/g, " ").trim() + "*";

  const rows = await env.DB.prepare(`
    SELECT wp.slug, wp.title, wp.summary, wp.entity_type,
           wp.unverified_count, bm25(wiki_fts) AS score
    FROM wiki_fts
    JOIN wiki_pages wp ON wiki_fts.slug = wp.slug
    WHERE wiki_fts MATCH ?
      ${typeClause}
    ORDER BY score
    LIMIT ?
  `).bind(q, limit).all();

  return { results: rows.results ?? [] };
}
```

**Notes:**
- `bm25()` in SQLite returns negative numbers; lower = better match. Do not invert.
- The `porter ascii` tokenizer in the FTS5 schema handles stemming (e.g. "transfer" matches "transferred").
- Prefix wildcard (`*`) means partial queries like "frog" will match "frogs".
- Input sanitization is mandatory — FTS5 MATCH syntax can throw on raw user input.

**BYOK tool definition (send to LLM in client):**
```json
{
  "name": "search_wiki",
  "description": "Searches the Ordinal Mind wiki for pages about inscriptions, collections, artists, or sats. Use for factual context about any entity mentioned in the conversation.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural language search query" },
      "limit": { "type": "number", "description": "Max results (default 5, max 10)" },
      "entity_type": {
        "type": "string",
        "enum": ["inscription", "collection", "artist", "sat"],
        "description": "Filter by entity type (optional)"
      }
    },
    "required": ["query"]
  }
}
```

---

## Tool: `get_raw_events`

Returns Layer 0 raw events for an inscription. The source of truth the model
must prefer over any wiki content for factual claims.

**Input:**
```typescript
{ inscription_id: string; event_types?: string[]; limit?: number }
```

**Implementation:**
```typescript
async function getRawEvents(
  input: { inscription_id: string; event_types?: string[]; limit?: number },
  env: Env
) {
  let query = `
    SELECT id, event_type, timestamp, block_height, source_type,
           source_ref, description, metadata_json
    FROM raw_chronicle_events
    WHERE inscription_id = ?
  `;
  const binds: any[] = [input.inscription_id];

  if (input.event_types?.length) {
    const ph = input.event_types.map(() => "?").join(",");
    query += ` AND event_type IN (${ph})`;
    binds.push(...input.event_types);
  }
  query += ` ORDER BY timestamp ASC LIMIT ?`;
  binds.push(input.limit ?? 50);

  const rows = await env.DB.prepare(query).bind(...binds).all();
  return {
    inscription_id: input.inscription_id,
    event_count: rows.results.length,
    events: rows.results.map((r: any) => ({
      ...r,
      metadata: JSON.parse(r.metadata_json)
    }))
  };
}
```

**BYOK tool definition:**
```json
{
  "name": "get_raw_events",
  "description": "Fetches verified on-chain and off-chain events for an inscription from the immutable Layer 0 store. Always prefer this over wiki content for factual claims about specific events.",
  "input_schema": {
    "type": "object",
    "properties": {
      "inscription_id": { "type": "string" },
      "event_types": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter: genesis, transfer, sale, social_mention, sat_context"
      },
      "limit": { "type": "number" }
    },
    "required": ["inscription_id"]
  }
}
```

---

## Tool: `get_timeline`

Returns the cached Chronicle timeline, reusing existing KV cache infrastructure.

**Input:**
```typescript
{ inscription_id: string }
```

**Implementation:**
```typescript
async function getTimeline(input: { inscription_id: string }, env: Env) {
  // Reuse existing cache.ts logic
  const cacheKey = `chronicle:${input.inscription_id}`;
  const cached = await env.KV.get(cacheKey, "json");
  if (cached) return { source: "cache", timeline: cached };

  // If not cached, return raw events as fallback
  const events = await getRawEvents({ inscription_id: input.inscription_id }, env);
  return { source: "layer0", timeline: events };
}
```

---

## Tool: `get_collection_context`

Returns a collection's wiki page and basic stats.

**Input:**
```typescript
{ collection_slug: string }
```

**Implementation:**
```typescript
async function getCollectionContext(
  input: { collection_slug: string },
  env: Env
) {
  const wikiSlug = `collection:${input.collection_slug}`;
  const page = await env.DB.prepare(
    "SELECT * FROM wiki_pages WHERE slug = ?"
  ).bind(wikiSlug).first();

  // Count inscriptions in this collection from Layer 0
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen
    FROM raw_chronicle_events
    WHERE metadata_json LIKE ?
      AND event_type = 'genesis'
  `).bind(`%${input.collection_slug}%`).first();

  return { page: page ?? null, stats };
}
```

**BYOK tool definition:**
```json
{
  "name": "get_collection_context",
  "description": "Retrieves wiki page and stats for a Bitcoin Ordinals collection. Use when the user asks about a collection an inscription belongs to.",
  "input_schema": {
    "type": "object",
    "properties": {
      "collection_slug": { "type": "string", "description": "Collection slug, e.g. bitcoin-frogs" }
    },
    "required": ["collection_slug"]
  }
}
```

---

## System Prompt for Wiki Chat (embed in `wikiAdapter.ts`)

```
You are the Ordinal Mind Chronicle assistant. You have access to tools that
query verified on-chain data and a growing wiki of Bitcoin Ordinals knowledge.

RULES:
- Always prefer get_raw_events over wiki content for specific factual claims.
- When citing an event, mention its source_ref (TXID or URL) so the user can verify.
- If a tool returns partial: true, acknowledge the data may be incomplete.
- Never fabricate inscription numbers, block heights, prices, or rarity ranks.
- If asked about something not in your tools' results, say so explicitly.
- Keep responses concise. The collector wants facts, not narrative.
```
