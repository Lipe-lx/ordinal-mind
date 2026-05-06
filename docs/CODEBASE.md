# Codebase Map: Ordinal Mind

This is the current structure and responsibility map of the repository.

## Root

- `README.md`: project overview and operational commands.
- `ARCHITECTURE.md`: system architecture and data flow.
- `AGENTS.md`: product and implementation guardrails.
- `wrangler.jsonc`: Worker entrypoint, KV binding, assets config.
- `vite.config.ts`: React + Cloudflare Vite plugin.
- `package.json`: scripts and dependencies.
- `migrations/`: D1 database schema migrations.

## Frontend (`src/app`)

### Routes and app shell

- `main.tsx`: React bootstrap.
- `router.tsx`: route definitions (Home, Address, Chronicle, Wiki).
- `pages/Home.tsx`: input/search entry.
- `pages/AddressPage.tsx`: wallet address explorer and inscription grid.
- `pages/Chronicle.tsx`: main Chronicle screen; wires Worker stream + chat hook.
- `pages/WikiPage.tsx`: collection-level wiki view with factual L0 data injection.

### Components

- `components/Layout.tsx`: top-level layout, Discord Connect, and BYOK modal.
- `components/ChronicleCard.tsx`: center card with tabs (Narrative / Genealogical Tree / Wiki Atlas), narrative chat.
- `components/NarrativeChatRenderer.tsx`: transcript, prompt box, and the new **Activity Dropdown** (Research/Status).
- `components/WikiGraphModal.tsx`: **Wiki Atlas** neural graph visualization (force-directed layout).
- `components/WikiReviewModal.tsx`: interface for reviewing and approving wiki contributions.
- `components/ChatHistoryModal.tsx`: refactored 2-column grid for chat session management.
- `components/TemporalTree.tsx`: factual event timeline.
- `components/GenealogyTree.tsx`: relation visualization.
- `components/BYOKModal.tsx`: provider/model/API-key and Discord identity status.
- `components/widgets/`: specialized factual widgets (Metadata, Ownership, Sources, Rarity, Collection Context).

### Identity and Auth (`src/app/lib`)

- `useDiscordIdentity.ts`: React hook for managing OAuth, JWT session, and Collector Tiers.
- `keyEncryption.ts`: AES-256-GCM encrypted persistence for LLM keys.

### BYOK and Chat Engine (`src/app/lib/byok`)

- `index.ts`: provider registry, model lists, and adapter factory.
- `prompt.ts`: centralized system prompt with Chronicle, Wiki, and Research policies.
- `chatIntentRouter.ts`: classifies user intent (greeting, query, contribution, research).
- `wikiExtractor.ts`: parses `<wiki_contribution>` tags from LLM output.
- `toolExecutor.ts`: client-side execution of research tools (mempool, ordinals, web).
- `chatStorage.ts`: indexedDB/localStorage persistence for chat threads.
- `useChronicleNarrativeChat.ts`: main orchestration hook for the narrative experience.
- `wikiSeedAgent.ts`: proactive background extraction of wiki fields from narrative.
- `wikiSubmit.ts`: shared utility for submitting wiki contributions.
- `adapters/`: `openai.ts`, `anthropic.ts`, `gemini.ts`, `openrouter.ts` provider implementations.

### Shared App Utilities

- `lib/types.ts`: shared DTO/types between frontend and Worker.
- `lib/wikiTypes.ts`: types for the consensus and wiki engine.
- `lib/wikiGraph.ts`: Cytoscape configuration and graph layout logic.
- `lib/wikiLint.ts`: client-side validation for wiki entries.
- `lib/formatters.tsx`: recursive text formatting and glassmorphism styling.

## Worker (`src/worker`)

### Core Engine

- `resolver.ts`: entry point for ID/Address normalization and resolution.
- `timeline.ts`: merges multiple data sources into a single deterministic chronology.
- `validation.ts`: cross-checks data between indexers to ensure factuality.
- `rarity.ts`: calculates satoshi rarity and provenance markers.
- `db.ts`: shared D1 database interface and helpers.
- `security.ts`: CSP headers, rate limiting, and origin validation.

### Entry and Routing

- `index.ts`: Worker entrypoint and route orchestration.
- `routes/auth.ts`: Discord OAuth PKCE flow and session management.
- `routes/wiki.ts`: wiki namespace router (contribute, consolidated, health).

### Data Pipeline (`src/worker/pipeline`)

- `phases.ts`: definition of the 4 resolution phases (L0-L3).
- `defaults.ts`: default event types and normalization rules.
- `withRetry.ts`: robust fetching wrapper for upstream APIs.

### Wiki & Consensus Engine (`src/worker/wiki`)

- `consolidate.ts`: multi-tier consensus logic (Genesis/OG/Community).
- `graph.ts`: generates nodes and edges for the Wiki Atlas.
- `reviews.ts`: handles approval/rejection of contributions.
- `lint.ts`: server-side validation and formatting of contributions.
- `completeness.ts`: calculates knowledge gaps for builder mode incentives.
- `schema.ts`: D1 schema management and readiness checks.
- `persistEvents.ts`: immutable raw Chronicle event persistence to D1.

### Data Agents (`src/worker/agents`)

- `ordinals.ts`, `mempool.ts`, `unisat.ts`: on-chain and indexer data fetching.
- `collections.ts`, `collectionProfiles.ts`: metadata and rarity enrichment.
- `webResearch.ts`: scraping and public signal discovery.

### Auth Engine (`src/worker/auth`)

- `tierEngine.ts`: server-side Tier calculation (Genesis, OG, Community).
- `discord.ts`: Discord API adapter.
- `jwt.ts`: stateless session management via signed tokens.

## Tests (`tests`)

### App Tests (`tests/app`)
- `byok*.test.ts`: context, adapter, and prompt behaviors.
- `wiki*.test.ts`: lifecycle, extractor, lint, and graph logic.
- `chat*.test.ts`: intent routing, storage, and policy enforcement.
- `discordIdentity.test.ts`, `keyEncryption.test.ts`: auth and security.

### Worker Tests (`tests/worker`)
- `resolver.test.ts`, `timeline.test.ts`, `rarity.test.ts`: data pipeline validation.
- `wiki*.test.ts`: routes, persistence, and contribution logic.
- `auth.test.ts`: JWT and tier engine validation.
- `chronicleSmoke.test.ts`: end-to-end pipeline smoke test.

## Current Known Boundaries

- Wiki requires D1 migrations (`npm run db:migrate:local`).
- LLM synthesis is strictly client-side; keys never leave the browser.
- Factual Layer 0 (On-chain) has priority over Layer 1 (Wiki) narrative.
