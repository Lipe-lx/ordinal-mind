# Ordinal Mind

Factual Chronicle engine for Bitcoin Ordinals collectors.

Ordinal Mind provides a verifiable temporal tree of Bitcoin assets, optional LLM-generated narratives, and shareable Chronicle cards, all built on a "factual first" architecture.

## Core Philosophy

*   **Factual First**: Every event is traceable to public on-chain or off-chain sources.
*   **Public Data Only**: No login, no wallet connect, no paid APIs (unless user-provided).
*   **BYOK (Bring Your Own Key)**: AI synthesis happens strictly client-side. User LLM keys never touch the server.
*   **Graceful Degradation**: The core experience (temporal tree) remains functional even if AI synthesis fails.

## Tech Stack

*   **Frontend**: React 19, Vite, React Router 7, Motion (animations), React Markdown.
*   **Backend**: Cloudflare Workers (TypeScript).
*   **Storage**: Cloudflare KV (Caching public data).
*   **Testing**: Vitest for unit and smoke testing.
*   **Styling**: Vanilla CSS with modern design tokens.

## Project Structure

```text
├── src/
│   ├── app/                # React Frontend
│   │   ├── components/     # UI Components (TemporalTree, ChronicleCard, BYOKModal)
│   │   ├── pages/          # Application Routes (Home, Chronicle)
│   │   └── lib/            # Client-side logic and BYOK adapters
│   └── worker/             # Cloudflare Worker (Orchestrator)
│       ├── agents/         # Specialized data fetchers
│       │   ├── ordinals.ts # ordinals.com on-chain data
│       │   ├── mempool.ts  # mempool.space UTXO tracking
│       │   ├── unisat.ts   # UniSat API (Rarity & Marketplace)
│       │   ├── collections.ts # Satflow & Ord.net metadata
│       │   └── xsearch.ts  # X mentions via DDG scraping
│       ├── timeline.ts     # Event tree construction & deduplication
│       ├── resolver.ts     # Input normalization (Inscription/Address)
│       ├── cache.ts        # KV TTL & Caching logic
│       └── index.ts        # Worker Entry Point & Orchestration
├── wrangler.jsonc          # Cloudflare Worker configuration
├── vite.config.ts          # Vite build & plugin configuration
└── AGENTS.md               # Product rules and implementation guidelines
```

## Core Features

*   **Verifiable Timeline**: Deterministic merging of on-chain transfers, genesis data, and marketplace activity.
*   **Chronicle Card**: Premium, interactive UI with 3D hover effects for asset visualization.
*   **Collection Intelligence**: Cross-referencing multiple sources (Ord.net, Satflow) for accurate provenance.
*   **X Mentions**: Fragile but robust discovery of social context via public scraping.
*   **Sat Rarity**: Integration with UniSat and on-chain CBOR for satoshis rarity profiles.

## Getting Started

### Prerequisites
- Node.js & npm
- Cloudflare Wrangler (for deployment)

### Installation
```bash
npm install
```

### Development
```bash
# Run Vite dev server and Wrangler locally
npm run dev
```

### Testing
```bash
# Run all tests
npm run test

# Run smoke tests only
npm run test:smoke
```

### Deployment
```bash
# Build and deploy to Cloudflare Pages/Workers
npm run deploy
```

## Security & Privacy
- **Zero Custody**: No user secrets or keys are ever stored or proxied.
- **Deterministic**: Same input and upstream data produce identical Chronicle events.
- **Cache Policy**: Only public, immutable, or short-lived public data is cached in KV.
