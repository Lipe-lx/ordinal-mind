# Ordinal Mind

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Ordinal Mind** is a high-performance factual resolution engine for Bitcoin Ordinals. It architectures a verifiable temporal tree of assets by orchestrating multi-source on-chain data with client-side AI synthesis.

---

## 🏗️ System Architecture

Ordinal Mind operates on a **Stateless Data Plane** coupled with a **Client-Side Synthesis Layer**, ensuring that sensitive credentials (LLM keys) never touch the server runtime.

```mermaid
graph LR
    subgraph "Public Data Plane (Worker)"
        R[Resolver] --> A[Agents]
        A --> KV[(KV Cache)]
        A --> D1[(D1 Wiki)]
    end
    
    subgraph "Security Layer"
        OAuth[Discord PKCE] --> JWT[Stateless JWT]
    end
    
    subgraph "Client Runtime (Browser)"
        UI[React UI] --> BYOK[BYOK LLM Adapter]
        BYOK --> AES[AES-256-GCM Storage]
        UI --> Graph[Neural Wiki Atlas]
    end

    R -.-> UI
    JWT -.-> UI
```

---

## 🛠️ Technical Stack

| Category | Technology |
| :--- | :--- |
| **Compute** | Cloudflare Workers (Edge Runtime) |
| **Storage** | Cloudflare D1 (SQL), Cloudflare KV (Cache) |
| **Frontend** | React 19, Motion 12, Cytoscape.js (Neural Graph) |
| **Identity** | Discord OAuth2 (PKCE), HMAC-SHA256 JWT |
| **MCP** | MCP TypeScript SDK v1, Cloudflare `createMcpHandler`, OAuth 2.1 |
| **AI/LLM** | Client-side BYOK (OpenAI, Anthropic, Gemini) |
| **Tooling** | Vite 6, Vitest, Wrangler |

---

## ⛓️ Resolution Pipeline (L0-L3)

Ordinal Mind resolves assets through a tiered verification pipeline:

- **Layer 0 (Factual)**: Atomic event resolution from `ordinals.com`, `mempool.space`, and `UniSat`.
- **Layer 1 (Consensus)**: Human-contributed knowledge via the **Wiki Engine**, weighted by Discord Collector Tiers (`Genesis` > `OG` > `Community`).
- **Layer 2 (Narrative)**: Deterministic prompt construction for client-side LLM synthesis.
- **Layer 3 (Discovery)**: Heuristic web signal discovery and X (Twitter) mention scraping.

---

## 🚀 Key Features

- **🌐 Multi-Source Orchestration**: Deterministic merging of disparate indexer data into a single chronology.
- **🧠 Wiki Atlas**: Force-directed neural graph visualization (`cytoscape-fcose`) of asset relationships.
- **💬 Intent-Aware Chat**: Client-side chat loop with integrated research tools and `<wiki_contribution>` extraction.
- **🛡️ Sealed Security**: LLM keys are encrypted at-rest in `localStorage` using **AES-256-GCM** derived from the user's JWT.
- **⚡ SSE-Powered Progress**: Real-time resolution status and research activity monitoring via Server-Sent Events.
- **🌱 Proactive Wiki Population**: Background extraction of structured knowledge from the first narrative to seed the wiki immediately.

---

## 🏁 Quick Start

### Development Environment
```bash
# 1. Install dependencies
npm install

# 2. Initialize local D1 database
npm run db:migrate:local

# 3. Start the edge-runtime dev server
npm run dev
```

### Quality Assurance
```bash
# Execution of the 40+ unit and integration tests
npm run test

# Static type analysis
npm run typecheck
```

---

## 📡 API Interface

| Endpoint | Method | Scope | Description |
| :--- | :--- | :--- | :--- |
| `/api/chronicle` | `GET` | Public | SSE stream of inscription metadata and events. |
| `/api/wiki/collection/:slug/consolidated` | `GET` | Public | Merged L0/L1 consensus-driven data. |
| `/api/wiki/collection/:slug/graph` | `GET` | Public | Neural graph nodes and edges. |
| `/api/wiki/contribute` | `POST` | Auth | Submit structured knowledge updates. |
| `/api/auth/discord` | `GET` | Public | Initiate Discord PKCE handshake. |

## 🔌 MCP Interface

| Endpoint | Method | Scope | Description |
| :--- | :--- | :--- | :--- |
| `/mcp` | `GET`, `POST`, `DELETE`, `OPTIONS` | Public/Auth | MCP Streamable HTTP endpoint (feature-flagged, per-request server instance). |
| `/mcp/oauth/authorize` | `GET` | Public | Starts MCP OAuth 2.1 authorization flow via Discord identity. |
| `/mcp/oauth/callback` | `GET` | Public | OAuth callback endpoint for the MCP flow. |
| `/mcp/oauth/token` | `POST` | Public | MCP OAuth token endpoint (provider-managed). |
| `/mcp/oauth/register` | `POST` | Public | MCP OAuth dynamic client registration endpoint (provider-managed). |
| `/.well-known/oauth-protected-resource` | `GET` | Public | Protected resource metadata for MCP clients. |

### MCP Resources

- `chronicle://inscription/{id}`: factual chronicle from KV-first pipeline with guardrails.
- `wiki://collection/{slug}`: tier-weighted wiki consolidated snapshot.
- `collection://context/{slug}`: collection context + graph summary (+ inscription context when slug is inscription id).

### MCP Tools and Capability Gates

- `contribute_wiki`: `community`, `og`, `genesis`.
- `review_contribution`: `genesis` only.
- `refresh_chronicle`: `genesis` only, supports `notifications/progress`.
- `reindex_collection`: `genesis` only, supports `notifications/progress`.
- Anonymous MCP access exposes resources only.

### MCP Runtime Flags

- `MCP_ENABLED=1`: enables `/mcp` routing.
- `MCP_OAUTH_ENABLED=1`: enables dedicated MCP OAuth endpoints and token validation.
- `MCP_SPEC_TARGET=2025-11-25`: project compliance target marker for MCP behavior and reviews.

### KV Best Practice for OAuth

`OAUTH_KV` should use a dedicated KV namespace (not shared with `CHRONICLES_KV`) to isolate OAuth transient state and token records from factual chronicle cache data.

---

## 📖 Technical Documentation

- 🗺️ [**ARCHITECTURE.md**](./docs/ARCHITECTURE.md): Deep dive into data flow and consensus.
- 🗺️ [**CODEBASE.md**](./docs/CODEBASE.md): Responsibility map and directory structure.
- 🤖 [**AGENTS.md**](./AGENTS.md): Product thesis and implementation constraints.

---

<p align="center">
  <i>Ordinals are forever. Deal with it.</i>
</p>
