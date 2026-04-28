# Codebase Map: Ordinal Mind

This document provides a detailed overview of the Ordinal Mind codebase, its directory structure, and file-level responsibilities.

## Directory Structure

### `src/app/` (Frontend)
The frontend is a React 19 application powered by Vite.

- **`components/`**: UI Building blocks.
    - `ChronicleCard.tsx`: The main visual container for an inscription's chronicle.
    - `GenealogyTree.tsx`: Visualizes the relationship between parents and children inscriptions.
    - `TemporalTree.tsx`: Renders the chronological list of events.
    - `BYOKModal.tsx`: Interface for managing client-side LLM keys.
    - `widgets/`: Modular UI sections (Rarity, Ownership, Sources, etc.).
- **`lib/`**: Frontend utilities and types.
    - `byok/`: The "Bring Your Own Key" synthesis engine.
        - `adapters/`: Provider-specific implementations (Anthropic, Gemini, OpenAI).
        - `useSynthesize.ts`: React hook for client-side generation.
    - `types.ts`: Shared TypeScript interfaces between the Worker and the App.
- **`pages/`**: Top-level route components.
    - `Home.tsx`: Search and entry point.
    - `Chronicle.tsx`: The main results page.
- `router.tsx`: React Router 7 configuration.
- `main.tsx`: Entry point for the React application.

### `src/worker/` (Backend/Orchestrator)
A Cloudflare Worker that aggregates and normalizes public Bitcoin Ordinals data.

- **`agents/`**: Isolated data fetching modules.
    - `ordinals.ts`: Fetches base metadata from ordinals.com.
    - `mempool.ts`: Tracks forward transfers and sales heuristics via mempool.space.
    - `unisat.ts`: Enriches data with UniSat indexer info and marketplace rarity.
    - `collections.ts`: Resolves collection context and parent-child relationships.
    - `mentions/`: Aggregates social signals and attention metrics.
    - `webResearch.ts`: Discovers external lore and context.
- **Core Logic**:
    - `resolver.ts`: Normalizes input (ID, Number, or Address).
    - `timeline.ts`: Pure function that merges disparate data into a chronological event tree.
    - `cache.ts`: Handles KV interactions with deterministic keys.
    - `validation.ts`: Cross-source data integrity checks.
    - `index.ts`: The orchestrator. Handles SSE streaming and standard JSON responses.

### `tests/`
- **`app/`**: Unit tests for frontend logic (BYOK context, media utilities).
- **`worker/`**: Integration and smoke tests for the orchestration pipeline.
    - `chronicleSmoke.test.ts`: Verifies the full pipeline for known inscriptions.

## Key Data Structures

### `InscriptionMeta`
The base metadata for an inscription, normalized from multiple sources.

### `ChronicleEvent`
A single node in the temporal tree.
```typescript
interface ChronicleEvent {
  id: string;
  timestamp: string;
  block_height: number;
  event_type: "genesis" | "transfer" | "sale" | "social_mention" | "sat_context" | ...;
  source: { type: "onchain" | "web", ref: string };
  description: string;
  metadata: any;
}
```

### `CollectorSignals`
Attention and sentiment metrics derived from social data.

## Development Workflow

- **Type Safety**: TypeScript is enforced across the entire stack. Run `npm run typecheck` to validate.
- **Testing**: `npm run test` executes the full suite. Use `npm run test:smoke` for quick pipeline validation.
- **Linting**: ESLint with React and TypeScript plugins.
- **Deployment**: `npm run deploy` builds the frontend and deploys the worker via Wrangler.
