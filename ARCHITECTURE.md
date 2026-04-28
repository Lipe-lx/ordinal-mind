# Architecture: Ordinal Mind

Ordinal Mind uses a factual-first split architecture:
- Worker builds and serves verifiable Chronicle data from public sources.
- Client performs optional BYOK AI synthesis/chat on top of that data.

## High-Level Runtime

```mermaid
graph TD
  U[User] --> C[React Client]
  C -->|GET /api/chronicle| W[Cloudflare Worker]
  W --> R[Resolver]
  R --> A[Data Agents]
  A --> O[ordinals]
  A --> M[mempool]
  A --> K[collections/context]
  A --> S[mentions + research]
  A --> U2[UniSat optional]
  A --> T[Timeline + Validation + Rarity]
  T --> KV[(Cloudflare KV)]
  W -->|JSON or SSE| C

  C -->|BYOK key in browser| LLM[OpenAI/Anthropic/Gemini/OpenRouter]
  C --> Chat[Chronicle Narrative Chat]
  Chat --> UI[Timeline + Narrative + Genealogy]

  C -->|POST /api/wiki/tools/*| W
  W --> Wiki[Wiki Tool Routes (contract-first)]
```

## Layer 1: Worker Data Plane (Factual)

### Responsibilities

- Normalize input (`resolver.ts`).
- Fetch from public/indexer sources (`agents/*`).
- Merge into deterministic chronology (`timeline.ts`).
- Validate/cross-check (`validation.ts`).
- Compute enrichment (`rarity.ts`, collection context).
- Cache public results in KV (`cache.ts`).

### API behavior

- `GET /api/chronicle?id=...`
  - standard JSON response with full chronicle object
- `GET /api/chronicle?id=...&stream=1`
  - SSE progress and final result
- cache bypass on stream/debug paths

### Invariants

- Timeline must not depend on AI.
- Events remain source-backed and ordered.
- Partial upstream failures degrade gracefully rather than collapsing entire response.

## Layer 2: Client BYOK Plane (Narrative Chat)

### Responsibilities

- Keep provider key in browser session storage.
- Build prompt context from factual chronicle + conversation state.
- Stream model output directly from provider (no server proxy for user key).
- Execute optional research tools client-side via `toolExecutor`.

### Chat behavior (current)

- Multi-session per inscription:
  - create/resume/rename/delete sessions
  - persisted in `localStorage` (`chatStorage.ts`)
- Intent routing:
  - `greeting`, `smalltalk_social`, `acknowledgement`, `chronicle_query`, `clarification_request`, `offtopic_safe`
- Response policy:
  - QA mode default for follow-up queries
  - narrative mode only when explicitly requested
  - guardrails for repetition and verbosity
  - short factoid policy: direct answer + optional one evidence sentence
- Cross-session memory:
  - carries user intent from previous sessions
  - avoids replaying assistant long-form text into fresh session behavior

## Layer 3: Wiki Contract-First Plane (Current Minimal)

### Routes

- `POST /api/wiki/tools/get_timeline`
- `POST /api/wiki/tools/get_collection_context`
- `GET /api/wiki/:slug` -> structured `404` placeholder

### Current scope

- Contract-first namespace for future LLM Wiki expansion.
- Tool responses are currently cache-backed from Chronicle payloads.
- Full ingest/search persistence layer is not yet active in this phase.

## Caching Model

- KV keying by normalized inscription ID.
- Immutable-ish fields (genesis metadata) benefit from longer lifetime.
- More volatile context (market/social transfer activity) is refreshed more aggressively.
- Streaming requests prioritize freshness and observability over cache hits.

## Security and Privacy Model

- BYOK keys never sent to Worker.
- Worker stores only public data/cache artifacts.
- No auth/login/wallet flow required for core functionality.
- Client-side chat storage stores conversation/session metadata only.

## Failure and Degradation Strategy

- If a data source fails: return partial factual chronicle with source diagnostics.
- If AI/chat fails: timeline and factual widgets remain fully available.
- If wiki route is unavailable/missing: predictable structured error, no impact on Chronicle core route.

## Why this architecture

- Keeps factual provenance auditable.
- Keeps sensitive LLM credentials out of server runtime.
- Allows iterative evolution toward LLM Wiki without breaking current Chronicle UX.
