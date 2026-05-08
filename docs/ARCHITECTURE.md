# Architecture: Ordinal Mind

Ordinal Mind uses a factual-first split architecture:
- **Worker** builds and serves verifiable Chronicle data (Layer 0) from public sources.
- **Client** performs optional BYOK AI synthesis/chat and Wiki contributions (Layer 1/2) on top of that data.
- **MCP Surface** exposes read-first resources and capability-gated operational tools for agent clients.

## High-Level Runtime

```mermaid
graph TD
  U[User] --> C[React Client]
  C -->|GET /api/chronicle| W[Cloudflare Worker]
  W --> R[Resolver]
  R -->|Address| U2[UniSat: Inscription List]
  R -->|Inscription ID| A[Data Agents]
  A --> O[ordinals]
  A --> M[mempool]
  A --> K[collections/context]
  A --> S[mentions + research]
  A --> U2_2[UniSat: Enrichment optional]
  A --> T[Timeline + Validation + Rarity]
  T --> KV[(Cloudflare KV)]
  W -->|"JSON (Address List) or SSE (Timeline)"| C

  C -->|BYOK key in browser| LLM[OpenAI/Anthropic/Gemini/OpenRouter]
  C --> Chat[Chronicle Narrative Chat]
  Chat --> UI[Timeline + Narrative + Genealogy + Wiki Atlas]

  U -->|OAuth PKCE| D[Discord]
  D -->|code| W
  W -->|JWT| C
  C -->|AES-256-GCM Store| LS[localStorage]

  C -->|POST /api/wiki/contribute| W
  W --> Cons[Consensus Engine]
  Cons --> D1[(D1: Wiki Pages + Contributions + Stats)]
  
  C -->|GET /api/wiki/graph| W
  W --> Graph[Graph Engine]
  Graph -->|Neural Layout| UI

  MCPClient[MCP Client] -->|/mcp (Streamable HTTP)| W
  W --> MCPSrv[MCP Server per request]
  MCPSrv --> MCPRes[Resources: chronicle/wiki/context]
  MCPSrv --> MCPTools[Tools: contribute/review/refresh/reindex]
  MCPClient -->|OAuth 2.1| MCPOAuth[/mcp/oauth/* + well-known/]
  MCPOAuth --> W
```

## Layer 0: Worker Data Plane (Factual)

### Responsibilities

- Normalize input (`resolver.ts`).
- Fetch from public/indexer sources (`agents/*`).
- Merge into deterministic chronology (`timeline.ts`).
- Validate/cross-check (`validation.ts`).
- Compute enrichment (`rarity.ts`, collection context).
- Cache public results in KV (`cache.ts`).

## Layer 1: Identity & Authentication Plane

### Responsibilities

- Handle Discord OAuth2 with PKCE flow (`src/worker/routes/auth.ts`).
- Issue and verify JWTs signed with `JWT_SECRET`.
- Map Discord server roles to Collector Tiers (`Genesis`, `OG`, `Community`).
- Secure client-side LLM key storage using AES-256-GCM derived from JWT.

## Layer 2: Client BYOK Plane (Narrative Chat)

### Responsibilities

- Keep provider key in browser (sessionStorage for guests, encrypted localStorage for members).
- Build prompt context from factual chronicle + conversation state.
- Stream model output directly from provider (no server proxy for user key).
- Execute optional research tools client-side via `toolExecutor`.
- **Activity Monitoring**: Integrated dropdown for real-time research and status tracking.

## Layer 3: Chronicle Wiki & Consensus Plane

### Routes

- `GET /api/wiki/collection/:slug/consolidated`
- `GET /api/wiki/collection/:slug/graph`
- `POST /api/wiki/contribute`
- `POST /api/wiki/review`
- `GET /api/wiki/health`

### Consensus Logic

- **Tiered Weighting**: Contributions from `Genesis` and `OG` tiers have immediate canonical preference.
- **Strict Scoping**: Fields are scoped to `inscription` or `collection` levels (e.g., `artist` vs `founder`) to prevent data bleed.
- **Review Loop**: Anonymous or low-tier contributions enter a quarantine state for community/OG review.
- **Wiki Atlas**: A neural, force-directed graph (via `cytoscape-fcose`) visualizes the relationships between entities.
- **Parallel Wiki Seed Agent**: A client-side background agent that extract facts from the initial narrative to proactively populate the wiki database.
- **Discovery-First Indexing**: Collections with any consensus data (completeness > 0) are automatically seeded into the search index (`wiki_pages`), enabling immediate discovery via MCP and UI even before full narrative generation.

## MCP Plane (Agent Interop)

### Entry, lifecycle, and compatibility

- `/mcp` is mounted without changing existing `/api/*` behavior.
- A new `McpServer` instance is created per request (no global singleton).
- Route-level enablement is controlled by `MCP_ENABLED` and `MCP_OAUTH_ENABLED`.
- `MCP_SPEC_TARGET=2025-11-25` is used as the compatibility target marker.

### Resources-first model

- `chronicle://inscription/{id}`: factual timeline from KV-first path with D1 fallback.
- `wiki://collection/{slug}`: consolidated wiki snapshot with tier-weighted outputs.
- `collection://context/{slug}`: contextual collection summary and graph metadata.
- Resource guardrails enforce caps for payload size, provenance depth, event window, and collection links before returning payloads.
- Resource reads are read-oriented: no forced expensive recomputation in resource handlers.

### OAuth 2.1 and dedicated MCP token contract

- MCP auth is isolated from web session auth and uses dedicated OAuth token issuance.
- Discord remains identity provider input; the Worker issues MCP-scoped access tokens with tier/capability claims.
- OAuth endpoints:
  - `/mcp/oauth/authorize`
  - `/mcp/oauth/callback`
  - `/mcp/oauth/token`
  - `/mcp/oauth/register`
  - `/mcp/oauth/flow/start`
  - `/mcp/oauth/flow/authorize?flow_id=<flow_id>`
  - `/mcp/oauth/flow/status?flow_id=<flow_id>`
  - `/mcp/oauth/flow/complete`
  - `/mcp/oauth/flow/cancel`
  - `/.well-known/oauth-protected-resource` (provider-managed metadata flow)
- OAuth state/token records use `OAUTH_KV` (dedicated namespace recommended and configured).
- OAuth flow session state/nonce is coordinated through `MCP_OAUTH_STATE_DO` (strong consistency + one-time consume semantics).

### Capability gating

- Tier mapping remains: `anon`, `community`, `og`, `genesis`.
- Anonymous clients can access resources and read-only query tools.
- Tool registration is dynamic per request tier:
  - `help`: `anon|community|og|genesis`
  - `query_chronicle`: `anon|community|og|genesis`
  - `search_collection_inscriptions`: `anon|community|og|genesis`
  - `wiki_search_pages`: `anon|community|og|genesis`
  - `wiki_list_pages`: `anon|community|og|genesis`
  - `wiki_get_page`: `anon|community|og|genesis`
  - `wiki_stats`: `anon|community|og|genesis`
  - `wiki_list_fields`: `anon|community|og|genesis`
  - `wiki_get_field_status`: `anon|community|og|genesis`
  - `wiki_get_collection_context`: `anon|community|og|genesis`
  - `wiki_propose_update`: `community|og|genesis` (follows app governance: `community -> quarantine`, `og/genesis -> published`)
  - `contribute_wiki`: `community|og|genesis`
  - `review_contribution`: `genesis`
  - `refresh_chronicle`: `genesis`
  - `reindex_collection`: `genesis`

### Progressive operations

- `refresh_chronicle` and `reindex_collection` emit `notifications/progress` when `progressToken` is present.
- Tool-level rate limits are applied with dedicated KV prefixes to control loops and upstream cost.

## Security and Privacy Model

- **No Server Secrets**: LLM keys are never seen by the server.
- **Sealed Storage**: Authenticated users have their LLM keys encrypted with AES-256-GCM in `localStorage`.
- **Content Security Policy (CSP)**: Strict `script-src 'self'` in production. Automatically relaxes to include `'unsafe-inline'` and `ws:`/`wss:` in local development to support Vite Fast Refresh and HMR.
- **Public Data Only**: The Worker only scrapes public, cacheable data.
- **Stateless Identity**: Session state is carried by signed JWTs.
- **MCP Origin Hardening**: MCP requests validate `Origin` against trusted origins to mitigate DNS rebinding classes.

## Failure and Degradation Strategy

- **Auth Failure**: App falls back to Guest mode (Factual Timeline + ephemeral BYOK).
- **Consensus Failure**: Wiki shows the most recent "Good" state or falls back to raw L0 stats.
- **AI Failure**: Timeline and factual widgets remain fully available.

## Why this architecture

- Keeps factual provenance auditable.
- Keeps sensitive LLM credentials out of server runtime.
- Allows a community-driven Wiki to coexist with an immutable on-chain record.
