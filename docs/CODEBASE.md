# Codebase Map: Ordinal Mind

This is the current structure and responsibility map of the repository.

## Root

- `README.md`: project overview and operational commands.
- `ARCHITECTURE.md`: system architecture and data flow.
- `AGENTS.md`: product and implementation guardrails.
- `wrangler.jsonc`: Worker entrypoint, KV binding, assets config.
- `vite.config.ts`: React + Cloudflare Vite plugin.
- `package.json`: scripts and dependencies.
- `tests/`: app and worker tests.

## Frontend (`src/app`)

### Routes and app shell

- `main.tsx`: React bootstrap.
- `router.tsx`: route definitions.
- `pages/Home.tsx`: input/search entry.
- `pages/AddressPage.tsx`: wallet address explorer and inscription grid.
- `pages/Chronicle.tsx`: main Chronicle screen; wires Worker stream + chat hook.
- `pages/WikiPage.tsx`: collection-level wiki view with factual L0 data injection.
- `pages/DiscordAuthCallback.tsx`: client-side OAuth callback handler to bypass Vite dev-server issues.
- `components/Layout.tsx`: top-level layout, Discord Connect button, and BYOK modal integration.

### Main UI components

- `components/ChronicleCard.tsx`: center card with tabs (Narrative / Genealogical Tree), narrative chat and sources.
- `components/NarrativeChatRenderer.tsx`: transcript, prompt box, actions, chat controls; includes tier-badge rendering.
- `components/ChatHistoryModal.tsx`: resume/rename/delete chat sessions.
- `components/GenealogyTree.tsx`: relation visualization.
- `components/TemporalTree.tsx`: factual event timeline.
- `components/BYOKModal.tsx`: provider/model/API-key and research keys UI; includes Discord identity status.

### Identity and Auth (`src/app/lib`)

- `useDiscordIdentity.ts`: React hook for managing OAuth flow, JWT session verification, and Collector Tier calculation.
- `byok/index.ts`: includes `KeyStore` logic for AES-256-GCM encrypted persistence when authenticated.

### BYOK and chat engine (`src/app/lib/byok`)

- `index.ts`: provider registry, model lists, adapter factory, key store.
- `openai.ts`, `anthropic.ts`, `gemini.ts`, `openrouter.ts`: provider adapters with stream + tool-calling loops.
- `useChronicleNarrativeChat.ts`: chat orchestration hook; includes "Builder/QA mode" injection for Wiki contributions.

### Shared app utilities

- `lib/types.ts`: shared DTO/types between frontend and Worker.
- `lib/brandLinks.tsx`: links known entities in narrative text.
- `lib/formatters.tsx`: recursive text formatting for UX, glassmorphism aesthetics for addresses, inscriptions, and blocks.

### Styling

- `index.css`: global stylesheet entrypoint; imports the modular CSS tree.
- `styles/features/wiki/*`: collection wiki and consensus UI styles.

## Worker (`src/worker`)

### Entry and routing

- `index.ts`: Worker entrypoint, `/api/chronicle` orchestration, SSE streaming, auth/wiki delegation.
- `routes/auth.ts`: Discord OAuth PKCE flow initiation and callback processing.
- `routes/wiki.ts`: wiki namespace router, contribution handling, and consensus-driven page reads.

### Wiki & Consensus Engine (`src/worker/wiki`)

- `consolidate.ts`: merges L0 factual data with L1/L2 human contributions based on Tier weights.
- `completeness.ts`: calculates knowledge gaps for builder mode incentives.
- `schema.ts`: centralized D1 schema readiness checks.
- `persistEvents.ts`: immutable raw Chronicle event persistence to D1.

### Auth Engine (`src/worker/auth`)

- `discord.ts`: Discord API adapter for profile and guild membership verification.
- `jwt.ts`: stateless session management via signed tokens.
- `tiers.ts`: server-side Tier calculation logic.
- `crypto.ts`: server-side key derivation for client-side encryption.

## Tests (`tests`)

### App tests (`tests/app`)

- `byok*.test.ts`: provider context/adapter/prompt behaviors.
- `chatIntentRouter.test.ts`: intent classification policy.
- `chatPromptPolicy.test.ts`: response guardrails and verbosity control.
- `chatStorage.test.ts`: thread persistence, migration, rename/delete behavior.
- `media.test.ts`: media helper behavior.

### Worker tests (`tests/worker`)

- `resolver.test.ts`, `timeline.test.ts`, `rarity.test.ts`, `mempool.test.ts`, `collections.test.ts`, etc.
- `chronicleSmoke.test.ts`: scan pipeline smoke.
- `wikiRoutes.test.ts`: wiki health, ingest, search/tools, fail-soft schema behavior, and page-read contracts.
- `wikiPersistEvents.test.ts`: raw event persistence, insert-or-ignore behavior, and missing-schema degradation.

## Current Known Boundaries

- Wiki requires D1 migrations locally and remotely; use `npm run db:migrate:local` for `npm run dev` and `npm run db:migrate:remote` for deployed D1.
- Production builds may still emit the existing chunk-size warning from Vite.
- In sandboxed environments, Wrangler may emit a non-blocking log-write warning when it cannot write outside the workspace.
