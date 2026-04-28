# Ordinal Mind

Factual Chronicle engine for Bitcoin Ordinals collectors.

Ordinal Mind takes an inscription ID/number and returns:
- a verifiable temporal timeline (factual-first)
- collection and provenance context
- optional client-side AI chat/narrative (BYOK)

The product remains useful without AI: timeline and source-backed data are the core.

## Product Principles

- Factual first: timeline events are source-backed and chronologically deterministic.
- Public data only: no login, no wallet connect, no paid APIs required by default.
- BYOK only: LLM keys stay in the browser; Worker never proxies/stores user LLM keys.
- Graceful degradation: if LLM/chat fails, timeline still renders.

## Current Feature Set

- Chronicle pipeline on Worker:
  - resolver for inscription input
  - multi-source fetch (ordinals, mempool, collections, mentions, research, UniSat when key exists)
  - timeline build + validation + rarity + cache
- SSE scan mode (`/api/chronicle?stream=1`) with progress events.
- Chronicle UI with:
  - Temporal Timeline
  - Chronicle Narrative chat
  - Genealogical Tree
  - Sources and collector signals widgets
- BYOK providers:
  - OpenAI, Anthropic, Gemini, OpenRouter
- Chat UX (current):
  - multi-session history per inscription (new/resume/rename/delete)
  - intent routing (greeting/smalltalk/query/etc.)
  - QA-vs-narrative policy and anti-repetition guardrails
  - localStorage thread memory per inscription + cross-session user-intent memory
- Chronicle Wiki (D1-backed, fail-soft):
  - raw event persistence in `raw_chronicle_events`
  - BYOK-generated wiki page ingest with source-event validation
  - D1 FTS search and wiki chat tools
  - schema health endpoint for local/remote D1 readiness
  - `GET /api/wiki/health`
  - `POST /api/wiki/ingest`
  - `POST /api/wiki/tools/search_wiki`
  - `POST /api/wiki/tools/get_raw_events`
  - `POST /api/wiki/tools/get_timeline`
  - `POST /api/wiki/tools/get_collection_context`
  - `GET /api/wiki/:slug`

## Stack

- Frontend: React 19, React Router 7, Vite 6, Motion, React Markdown
- Backend: Cloudflare Worker (TypeScript)
- Cache: Cloudflare KV (`CHRONICLES_KV`)
- Tests: Vitest
- Styling: CSS tokens in `src/app/index.css`

## Quick Start

### Prerequisites
- Node.js 20+
- npm

### Install
```bash
npm install
```

### Run locally
```bash
npm run db:migrate:local
npm run dev
```

`npm run dev` uses local Miniflare D1 state. If you only apply migrations with
`--remote`, local dev can still report missing wiki tables.

### Build
```bash
npm run build
```

### Tests
```bash
npm run test
npm run test:smoke
```

### Typecheck
```bash
npm run typecheck
```

### Deploy
```bash
npm run db:migrate:remote
npm run deploy
```

## API Surface (Current)

- `GET /api/chronicle?id=<id|number>`
- `GET /api/chronicle?id=<id|number>&stream=1`
- `GET /api/chronicle?id=<id|number>&lite=1`
- `GET /api/wiki/health`
- `POST /api/wiki/ingest`
- `POST /api/wiki/tools/search_wiki`
- `POST /api/wiki/tools/get_raw_events`
- `POST /api/wiki/tools/get_timeline`
- `POST /api/wiki/tools/get_collection_context`
- `GET /api/wiki/:slug`

## Wiki D1 Troubleshooting

- `no such table: raw_chronicle_events`: run `npm run db:migrate:local` for local dev, or `npm run db:migrate:remote` for deployed D1.
- `no such table: wiki_pages`: same fix; both wiki migrations must be applied to the D1 database used by the runtime.
- Local vs remote D1: `vite dev`/Miniflare reads local D1 state by default, while `--remote` applies migrations only to the Cloudflare-hosted database.

## Security Notes

- LLM keys are managed in browser storage via BYOK UI.
- Worker only handles public data aggregation and caching.
- No server-side LLM completion with user keys.

## Docs

- [CODEBASE.md](./CODEBASE.md): file-by-file map
- [ARCHITECTURE.md](./ARCHITECTURE.md): runtime architecture and data flow
- [AGENTS.md](./AGENTS.md): implementation constraints and product rules
