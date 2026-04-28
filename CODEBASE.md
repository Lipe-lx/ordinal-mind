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
- `pages/Chronicle.tsx`: main Chronicle screen; wires Worker stream + chat hook.
- `components/Layout.tsx`: top-level layout and BYOK modal integration.

### Main UI components

- `components/ChronicleCard.tsx`: center card with tabs (Narrative / Genealogical Tree), narrative chat and sources.
- `components/NarrativeChatRenderer.tsx`: transcript, prompt box, actions, chat controls.
- `components/ChatHistoryModal.tsx`: resume/rename/delete chat sessions.
- `components/GenealogyTree.tsx`: relation visualization.
- `components/TemporalTree.tsx`: factual event timeline.
- `components/ChronicleSidebar.tsx`: inscription preview/metadata side panel.
- `components/BYOKModal.tsx`: provider/model/API-key and research keys UI.
- `components/widgets/*`: ownership, collection context, sources, rarity, metadata widgets.

### BYOK and chat engine (`src/app/lib/byok`)

- `index.ts`: provider registry, model lists, adapter factory, key store.
- `openai.ts`, `anthropic.ts`, `gemini.ts`, `openrouter.ts`: provider adapters with stream + tool-calling loops.
- `context.ts`: synthesis input preparation and model capability handling.
- `prompt.ts`: synthesis/chat prompts; QA vs narrative prompt policy.
- `useChronicleNarrativeChat.ts`: chat orchestration hook (streaming, session state, retry/cancel, auto-turn logic).
- `chatIntentRouter.ts`: intent routing (rules + semantic matching + fallback).
- `chatPolicies.ts`: local policy replies + anti-verbosity/anti-repetition guardrails.
- `chatStorage.ts`: multi-thread workspace persistence per inscription (`localStorage`), migration from v1, rename/delete.
- `chatTypes.ts`: message/thread/workspace contracts.
- `toolExecutor.ts`: provider-agnostic research/tool execution loop.
- `tools.ts`: tool definitions exposed to the model.
- `streamParser.ts`: SSE parsing for streaming responses.
- `searchProviders/*`: Brave/Exa/Perplexity/SerpApi/CoinGecko adapters.

### Shared app utilities

- `lib/types.ts`: shared DTO/types between frontend and Worker.
- `lib/brandLinks.tsx`: links known entities in narrative text.

### Styling

- `index.css`: design tokens + all layout/component styles.

## Worker (`src/worker`)

### Entry and routing

- `index.ts`: Worker entrypoint, `/api/chronicle` orchestration, SSE streaming, `/api/wiki/*` delegation.
- `routes/wiki.ts`: minimal wiki namespace router.
- `wiki/tools.ts`: `get_timeline` and `get_collection_context` tools (cache-backed).

### Data agents

- `agents/ordinals.ts`: inscription metadata and CBOR traits from ordinals sources.
- `agents/mempool.ts`: transfer traversal and on-chain movement context.
- `agents/unisat.ts`: optional enrichment via UniSat key when configured.
- `agents/collections.ts`: collection context/provenance and media context.
- `agents/mentions/*`: collector signals queries and normalization.
- `agents/webResearch.ts`: public web context discovery.

### Orchestration core

- `resolver.ts`: input normalization.
- `timeline.ts`: timeline merge/sort/dedupe.
- `validation.ts`: cross-source validation helpers.
- `rarity.ts`: rarity/context derivation.
- `collectionProfiles.ts`: collection profile shaping.
- `cache.ts`: KV cache access and keying.
- `db.ts`: validation persistence helper.

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
- `wikiRoutes.test.ts`: wiki route/tool contract behavior.

## Current Known Boundaries

- Wiki is currently contract-first (`/api/wiki/*` minimal); no full ingest/search persistence layer yet.
- Typecheck currently fails on a known preexisting type mismatch in `src/worker/agents/collections.ts` unrelated to chat/docs updates.
