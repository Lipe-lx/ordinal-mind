# Architecture: Ordinal Mind

Ordinal Mind uses a factual-first split architecture:
- **Worker** builds and serves verifiable Chronicle data (Layer 0) from public sources.
- **Client** performs optional BYOK AI synthesis/chat and Wiki contributions (Layer 1/2) on top of that data.

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
  W -->|JSON (Address List) or SSE (Timeline)| C

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

## Security and Privacy Model

- **No Server Secrets**: LLM keys are never seen by the server.
- **Sealed Storage**: Authenticated users have their LLM keys encrypted with AES-256-GCM in `localStorage`.
- **Public Data Only**: The Worker only scrapes public, cacheable data.
- **Stateless Identity**: Session state is carried by signed JWTs.

## Failure and Degradation Strategy

- **Auth Failure**: App falls back to Guest mode (Factual Timeline + ephemeral BYOK).
- **Consensus Failure**: Wiki shows the most recent "Good" state or falls back to raw L0 stats.
- **AI Failure**: Timeline and factual widgets remain fully available.

## Why this architecture

- Keeps factual provenance auditable.
- Keeps sensitive LLM credentials out of server runtime.
- Allows a community-driven Wiki to coexist with an immutable on-chain record.
