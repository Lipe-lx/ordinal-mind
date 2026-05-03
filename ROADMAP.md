# ROADMAP — OrdinalMind Identity + Wiki Builder

> Versão: 1.0 · Maio 2026
> Documento de referência para implementação dos três pilares: **Identidade Discord**, **Chat Wiki Builder**, e **Consolidação Canônica**.

---

## Estado Atual do Sistema

| Camada | Status | Arquivos-chave |
|--------|--------|---------------|
| Worker (Cloudflare) | ✅ Produção | `src/worker/index.ts`, `pipeline/phases.ts` |
| Bindings | KV + D1 | `wrangler.jsonc` (CHRONICLES_KV, DB) |
| D1 Schema | 2 migrations | `raw_chronicle_events`, `wiki_pages` + FTS |
| BYOK Engine | 4 providers | `src/app/lib/byok/` (25 arquivos) |
| Chat Intent Router | 6 intents | `chatIntentRouter.ts` |
| Wiki Layer | L0 events + L1 pages | `src/worker/wiki/`, `wikiAdapter.ts` |
| Frontend | React 19 + Motion 12 | 3 páginas, 18+ componentes |
| Testes | 36 test files | `tests/app/`, `tests/worker/` |

### Invariantes que NUNCA mudam

- Chronicle, Timeline, Wiki: sempre públicos, zero fricção
- Wallet connect: nunca
- LLM keys: nunca saem do browser
- Contribuição anon: sempre aceita, nunca publicada sem quarentena
- Discord: sempre opt-in, nunca obrigatório para leitura

---

## Pilar 1 — Identidade Discord ✅ CONCLUÍDO

### 1.1 Decisões de Arquitetura

**Sessão**: JWT stateless assinado com HMAC-SHA256 via Web Crypto API. Sem estado no servidor. Token armazenado em `localStorage` (não cookie, pois o app é SPA e as LLM keys já usam `sessionStorage`).

**Revogação**: Não implementar blacklist na v1. O JWT tem TTL curto (7 dias). Disconnect = limpar localStorage. Evolução futura: jti blacklist em KV.

**PKCE**: Obrigatório. O Worker gera `code_verifier` + `code_challenge`, armazena o verifier em KV com TTL de 5min keyed pelo `state`.

**Secrets**: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET` via `wrangler secret put`.

### 1.2 Novas Rotas no Worker

```
GET  /api/auth/discord          → gera state + PKCE, redireciona para Discord OAuth
GET  /api/auth/callback         → troca code por token, consulta Discord API, grava D1, devolve JWT
GET  /api/auth/me               → valida JWT, retorna perfil (avatar, username, tier)
POST /api/auth/disconnect       → opcional, apenas log para analytics
```

### 1.3 Migração D1 — `0003_users.sql`

```sql
CREATE TABLE IF NOT EXISTS users (
  discord_id       TEXT PRIMARY KEY,
  username         TEXT NOT NULL,
  avatar_hash      TEXT,
  og_tier          TEXT NOT NULL DEFAULT 'community',
  server_ids_json  TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(og_tier);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
```

### 1.4 OG Tier Engine

| Tier | Critério | Score peso |
|------|----------|-----------|
| `anon` | Sem Discord | 0.3 |
| `community` | Discord conectado, ≥1 server Ordinals | 0.6 |
| `og` | Conta >1 ano + servers específicos | 0.85 |
| `genesis` | Whitelist manual em KV (`og_genesis_whitelist`) | 1.0 |

**Servers reconhecidos** (configurável em KV como JSON):
```json
{
  "og_servers": ["server_id_nodemonkes", "server_id_puppets", "server_id_quantumcats"],
  "community_servers": ["server_id_ordinals_general", "server_id_bitcoin_nfts"]
}
```

O cálculo do tier acontece no callback OAuth. O Worker consulta `guilds` do usuário via Discord API (`identify` + `guilds` scopes).

### 1.5 Alterações no Frontend

**`Env` type** em `src/worker/index.ts`:
```typescript
export interface Env {
  // ... existentes ...
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  JWT_SECRET?: string
}
```

**`BYOKModal.tsx`**: Nova terceira tab "Identity" com botão "Connect Discord", estado conectado (avatar + username + tier badge), e botão "Disconnect".

**Novo hook `useDiscordIdentity.ts`**:
- `identity: { discordId, username, avatar, tier } | null`
- `connect()`, `disconnect()`, `isLoading`
- Lê/escreve JWT em `localStorage` key `ordinal-mind_discord_jwt`
- Valida expiração client-side antes de cada uso

### 1.6 Arquivos Novos e Modificados

| Ação | Arquivo | Descrição |
|------|---------|-----------|
| NEW | `src/worker/routes/auth.ts` | Rotas OAuth + callback + me |
| NEW | `src/worker/auth/jwt.ts` | Sign/verify JWT via Web Crypto |
| NEW | `src/worker/auth/discord.ts` | Discord API helpers (exchange, guilds, user) |
| NEW | `src/worker/auth/tierEngine.ts` | Cálculo de OG tier |
| NEW | `migrations/0003_users.sql` | Tabela users |
| NEW | `src/app/lib/useDiscordIdentity.ts` | Hook React de identidade |
| MOD | `src/worker/index.ts` | Adicionar Env fields + route delegation |
| MOD | `src/app/components/BYOKModal.tsx` | Tab Identity |
| MOD | `wrangler.jsonc` | (nenhuma binding nova, secrets via CLI) |

### 1.7 Testes

- `tests/worker/auth.test.ts`: JWT sign/verify, tier calculation, callback flow mock
- `tests/app/discordIdentity.test.ts`: hook state management, token expiry

---

## Pilar 2 — Chat Wiki Builder

### 2.1 Nova Intent: `knowledge_contribution`

**`chatIntentRouter.ts`** — Adicionar ao tipo `ChatIntent`:

```typescript
export type ChatIntent =
  | "greeting"
  | "smalltalk_social"
  | "acknowledgement"
  | "chronicle_query"
  | "clarification_request"
  | "offtopic_safe"
  | "knowledge_contribution"  // NEW
```

**Padrões de detecção L0** (rules):
```typescript
const CONTRIBUTION_PATTERNS = [
  /\b(eu (estava|vi|participei|lembro|sei))\b/u,
  /\b(i (was|saw|remember|know|witnessed))\b/u,
  /\b(na verdade|actually|correcting|corrigindo)\b/u,
  /\b(o fundador|the founder|criador|creator|quem criou|who created)\b/u,
]

const FIRST_PERSON_COLLECTION = [
  /\b(minha coleção|my collection|eu mint|i minted|eu comprei|i bought)\b/u,
  /\b(a gente|nós|we|our community|nossa comunidade)\b/u,
]
```

**Semântica L1**: Adicionar protótipos ao `PROTOTYPES`:
```typescript
knowledge_contribution: [
  "o fundador é o fulano", "essa coleção foi lançada em janeiro",
  "eu estava lá quando mintou", "the creator is known as",
  "na verdade o supply é 10000", "actually the mint was free",
]
```

### 2.2 Mapa de Completude por Coleção

**Novo arquivo `src/app/lib/byok/wikiCompleteness.ts`**:

```typescript
export interface CollectionCanonicalFields {
  founder: string | null
  launch_date: string | null
  launch_context: string | null
  origin_narrative: string | null
  technical_details: string | null
  notable_moments: string | null
  community_culture: string | null
  connections: string | null
  current_status: string | null
}

export interface CompletenessMap {
  collection_slug: string
  filled: number
  total: number
  missing_fields: (keyof CollectionCanonicalFields)[]
  fields: CollectionCanonicalFields
}
```

O mapa é construído a partir dos dados consolidados em D1. Antes de cada turno de chat, o frontend faz `GET /api/wiki/collection/:slug/completeness` e injeta no prompt.

### 2.3 Extração Estruturada

**Novo tipo `WikiContribution`**:

```typescript
export interface WikiContribution {
  field: keyof CollectionCanonicalFields
  value: string
  confidence: "stated_by_user" | "inferred" | "correcting_existing"
  verifiable: boolean
  collection_slug: string
  contributor_id: string | null  // discord_id ou null para anon
  og_tier: "anon" | "community" | "og" | "genesis"
  session_id: string
  source_chat_excerpt: string  // trecho da conversa que originou
}
```

**Fluxo no chat**:
1. Intent router detecta `knowledge_contribution`
2. Prompt muda para modo extrator (instruções adicionais no system prompt)
3. Modelo confirma informação com o usuário
4. Modelo gera bloco `<wiki_extract>...</wiki_extract>` junto com a resposta
5. `useChronicleNarrativeChat.ts` parseia o bloco e envia `POST /api/wiki/contribute`
6. Usuário nunca vê o bloco — apenas a resposta conversacional

### 2.4 Prompt de Modo Extrator

Adição ao `buildChatPolicyBlock` em `prompt.ts`:

```
Wiki Builder Mode:
- You detected the user has original knowledge about this collection.
- Your goal is to extract structured information naturally through conversation.
- Current collection completeness: {filled}/{total} fields.
- Missing fields: {missing_fields}.
- DO NOT ask questions like a form. Weave questions naturally into the conversation.
- When the user provides new information, confirm it conversationally.
- Generate a <wiki_extract> block with the structured data (hidden from user).
- Always validate: "You're saying X, correct? That's valuable context for this collection's chronicle."
- If user has no Discord connected, mention gently that contributions enter review.
```

### 2.5 Rota de Contribuição

**`POST /api/wiki/contribute`**:

```typescript
// Request body
interface ContributeRequest {
  contribution: WikiContribution
  jwt?: string  // optional Discord JWT
}

// Response
interface ContributeResponse {
  ok: boolean
  contribution_id: string
  status: "published" | "quarantine" | "duplicate"
  tier_applied: string
}
```

### 2.6 Migração D1 — `0004_wiki_contributions.sql`

```sql
CREATE TABLE IF NOT EXISTS wiki_contributions (
  id                TEXT PRIMARY KEY,
  collection_slug   TEXT NOT NULL,
  field             TEXT NOT NULL,
  value             TEXT NOT NULL,
  confidence        TEXT NOT NULL DEFAULT 'stated_by_user',
  verifiable        INTEGER NOT NULL DEFAULT 0,
  contributor_id    TEXT,
  og_tier           TEXT NOT NULL DEFAULT 'anon',
  session_id        TEXT NOT NULL,
  source_excerpt    TEXT,
  status            TEXT NOT NULL DEFAULT 'quarantine',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_wc_collection ON wiki_contributions(collection_slug);
CREATE INDEX IF NOT EXISTS idx_wc_field ON wiki_contributions(field);
CREATE INDEX IF NOT EXISTS idx_wc_status ON wiki_contributions(status);
CREATE INDEX IF NOT EXISTS idx_wc_tier ON wiki_contributions(og_tier);
CREATE INDEX IF NOT EXISTS idx_wc_contributor ON wiki_contributions(contributor_id);
```

### 2.7 Arquivos Novos e Modificados

| Ação | Arquivo | Descrição |
|------|---------|-----------|
| NEW | `src/app/lib/byok/wikiCompleteness.ts` | Tipos + fetch do mapa de completude |
| NEW | `src/app/lib/byok/wikiExtractor.ts` | Parser de `<wiki_extract>` blocks |
| NEW | `src/worker/wiki/contribute.ts` | Handler de contribuição + quarentena |
| NEW | `src/worker/wiki/completeness.ts` | Cálculo de completude por coleção |
| NEW | `migrations/0004_wiki_contributions.sql` | Tabela contributions |
| MOD | `src/app/lib/byok/chatIntentRouter.ts` | +intent `knowledge_contribution` |
| MOD | `src/app/lib/byok/prompt.ts` | +modo extrator no policy block |
| MOD | `src/app/lib/byok/useChronicleNarrativeChat.ts` | +extração + POST contribute |
| MOD | `src/worker/routes/wiki.ts` | +rotas contribute + completeness |

### 2.8 Testes

- `tests/app/chatIntentRouter.test.ts`: novos casos para `knowledge_contribution`
- `tests/app/wikiExtractor.test.ts`: parsing de blocos de extração
- `tests/worker/wikiContribute.test.ts`: contribuição, quarentena, tier weight

---

## Pilar 3 — Consolidação Canônica

### 3.1 Mecanismo de Consenso

```typescript
interface ConsolidatedField {
  field: string
  canonical_value: string | null
  status: "canonical" | "draft" | "disputed"
  contributions: Array<{
    value: string
    contributor_id: string | null
    og_tier: string
    weight: number
    created_at: string
  }>
  resolved_by_tier: string  // tier que definiu o valor canônico
}
```

**Regras de resolução**:
1. Contribuição `genesis` → canônica imediatamente
2. Contribuição `og` sem conflito → canônica
3. Múltiplas `og` com valores diferentes → `disputed`
4. Apenas `community`/`anon` → `draft` (aguardando confirmação de tier superior)

### 3.2 Rota de Consolidação

```
GET /api/wiki/collection/:slug/consolidated
```

Retorna:
```typescript
interface ConsolidatedCollection {
  collection_slug: string
  completeness: { filled: number; total: number; score: number }
  confidence: number  // média ponderada por tier
  factual: {  // Layer 0 — imutável, do Chronicle
    supply: number | null
    first_block: number | null
    last_mint_block: number | null
    floor_history: Array<{ block: number; price_btc: number }>
  }
  narrative: Record<string, ConsolidatedField>  // campos canônicos
  sources: Array<{
    contributor_id: string | null
    og_tier: string
    field: string
    created_at: string
  }>
  gaps: string[]  // campos sem contribuição verificada
}
```

### 3.3 Consolidação como Contexto do Chat

Em `prompt.ts`, adicionar seção de contexto consolidado:

```
Consolidated Wiki Context for {collection}:
Completeness: {filled}/{total} ({score}%)
Confidence: {confidence}

Known facts (community-verified):
- Founder: {value} (source: {tier}, {date})
- Origin: {value} ...

Disputed fields:
- {field}: "{value_a}" vs "{value_b}" (both from OG contributors)

Unknown fields (gaps):
- {field_list}

Use this consolidated context as enriched background. Prefer Layer 0 on-chain data
for event-level claims. Use consolidated narrative for cultural and historical context.
```

### 3.4 Página Wiki — `/wiki/:collection-slug`

**Nova página `src/app/pages/WikiPage.tsx`**:

Seções:
1. **Header**: nome, badge completude (ring progress), badge confiança
2. **Factual (L0)**: supply, blocos, floor — dados imutáveis do Chronicle
3. **Narrativo**: campos consolidados com badge de tier da fonte
4. **Em disputa**: campos com conflito, aberto para contribuição
5. **Lacunas**: campos vazios + botão "Contribuir via Chat"
6. **Histórico**: lista auditável de contribuições

**Botão "Contribuir via Chat"**: abre chat em modo builder. O `useChronicleNarrativeChat` recebe flag `wikiBuilderMode: true` + `targetGap: field_name`. O prompt já começa focado na lacuna.

### 3.5 Migração D1 — `0005_consolidated_cache.sql`

```sql
CREATE TABLE IF NOT EXISTS consolidated_cache (
  collection_slug   TEXT PRIMARY KEY,
  snapshot_json     TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0,
  completeness      REAL NOT NULL DEFAULT 0,
  contribution_count INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Cache materializado. Rebuild triggered por novas contribuições ou periodicamente.

### 3.6 Arquivos Novos e Modificados

| Ação | Arquivo | Descrição |
|------|---------|-----------|
| NEW | `src/worker/wiki/consolidate.ts` | Engine de consenso + agregação |
| NEW | `src/worker/wiki/consolidateTypes.ts` | Tipos de consolidação |
| NEW | `src/app/pages/WikiPage.tsx` | Página de coleção consolidada |
| NEW | `src/app/styles/features/wiki/` | CSS da página wiki |
| NEW | `migrations/0005_consolidated_cache.sql` | Cache de consolidação |
| MOD | `src/app/router.tsx` | +rota `/wiki/:slug` |
| MOD | `src/app/lib/byok/prompt.ts` | +contexto consolidado |
| MOD | `src/worker/routes/wiki.ts` | +rotas consolidation + completeness |

---

## Sequência de Sprints

### Sprint 1 — Fundação de Identidade ✅ CONCLUÍDO

| # | Tarefa | Prioridade | Status |
|---|--------|-----------|-------|
| 1.1 | Criar `auth/jwt.ts` com Web Crypto HMAC-SHA256 | Alta | ✅ |
| 1.2 | Criar `auth/discord.ts` (OAuth exchange + user + guilds) | Alta | ✅ |
| 1.3 | Criar `auth/tierEngine.ts` | Alta | ✅ |
| 1.4 | Criar `routes/auth.ts` com PKCE flow | Alta | ✅ |
| 1.5 | Migration `0003_users.sql` | Alta | ✅ |
| 1.6 | Criar `useDiscordIdentity.ts` hook | Alta | ✅ |
| 1.7 | Adicionar tab Identity no BYOKModal | Média | ✅ |
| 1.8 | Testes de auth (JWT, tier, callback) — 27 testes | Alta | ✅ |
| 1.9 | **Teste de aceitação**: nada quebra para anon | Crítica | ✅ |

> Arquivos extras criados além do plano original:
> - `src/worker/auth/jwt.ts`, `src/worker/auth/discord.ts`, `src/worker/auth/tierEngine.ts`
> - `src/app/lib/keyEncryption.ts` — AES-256-GCM at-rest para LLM keys em localStorage
> - `src/app/lib/byok/jwtClient.ts` — decoder JWT browser-safe
> - `src/app/lib/byok/index.ts` — KeyStore refatorado para dual-mode (sessionStorage anon / localStorage encrypted)
> - `tests/worker/auth.test.ts`, `tests/app/discordIdentity.test.ts`, `tests/app/keyEncryption.test.ts`

### Sprint 2 — Contribuição Estruturada (3–4 dias)

| # | Tarefa | Prioridade | Risco |
|---|--------|-----------|-------|
| 2.1 | Migration `0004_wiki_contributions.sql` | Alta | Baixo |
| 2.2 | Criar `wiki/contribute.ts` (handler + quarentena) | Alta | Baixo |
| 2.3 | Criar `wikiExtractor.ts` (parser de blocos) | Alta | Baixo |
| 2.4 | Modificar prompt com modo extrator | Alta | Médio — prompt engineering |
| 2.5 | Integrar extração no `useChronicleNarrativeChat.ts` | Alta | Médio |
| 2.6 | Rotas contribute + completeness no wiki router | Alta | Baixo |
| 2.7 | Testes de contribuição e extração | Alta | Baixo |

### Sprint 3 — Wiki Question Engine (2–3 dias)

| # | Tarefa | Prioridade | Risco |
|---|--------|-----------|-------|
| 3.1 | Criar `wikiCompleteness.ts` (mapa canônico) | Alta | Baixo |
| 3.2 | Adicionar intent `knowledge_contribution` ao router | Alta | Baixo |
| 3.3 | Refinar prompt para perguntas contextuais | Alta | Médio — tom natural |
| 3.4 | Completeness endpoint no worker | Média | Baixo |
| 3.5 | Testes com coleções reais (NodeMonkes, Puppets) | Alta | Médio |

### Sprint 4 — Consolidação e UI (4–5 dias)

| # | Tarefa | Prioridade | Risco |
|---|--------|-----------|-------|
| 4.1 | Criar `wiki/consolidate.ts` (consenso ponderado) | Alta | Médio |
| 4.2 | Migration `0005_consolidated_cache.sql` | Alta | Baixo |
| 4.3 | Rota `GET /api/wiki/collection/:slug/consolidated` | Alta | Baixo |
| 4.4 | Criar `WikiPage.tsx` + CSS | Alta | Médio — UI complexa |
| 4.5 | Rota `/wiki/:slug` no router | Alta | Baixo |
| 4.6 | Contexto consolidado no prompt do chat | Média | Baixo |
| 4.7 | Botão "Contribuir via Chat" com modo builder | Média | Baixo |

### Sprint 5 — OG Scoring e Moderação (2–3 dias)

| # | Tarefa | Prioridade | Risco |
|---|--------|-----------|-------|
| 5.1 | Whitelist `genesis` em KV | Alta | Baixo |
| 5.2 | Verificação de guilds no callback OAuth | Alta | Médio |
| 5.3 | Fila de quarentena para anon (UI admin futura) | Média | Baixo |
| 5.4 | Badges de tier no chat e na Wiki | Média | Baixo |
| 5.5 | Testes end-to-end do fluxo completo | Alta | Médio |

---

## Mapa de Dependências

```
Sprint 1 (Identity)
    ├── Sprint 2 (Contributions) ← depende de Identity para tier
    │       ├── Sprint 3 (Question Engine) ← depende de Contributions
    │       └── Sprint 4 (Consolidation) ← depende de Contributions
    └── Sprint 5 (OG Scoring) ← depende de Identity + Contributions
```

Sprint 2 e 3 podem correr em paralelo parcial. Sprint 4 depende de 2. Sprint 5 depende de 1+2.

---

## Decisões Técnicas Fundamentais

### JWT vs Cookie
**Decisão**: JWT em `localStorage`. O app é SPA, não faz SSR. Cookies HttpOnly complicariam o fluxo CORS com o Worker. O BYOK já usa `sessionStorage` para keys — seguimos o mesmo padrão para identidade, mas com `localStorage` para persistência entre sessões.

### PKCE State Storage
**Decisão**: KV com TTL de 5 minutos. Key: `pkce:{state}`, Value: `{code_verifier, created_at}`. Limpo automaticamente pelo TTL do KV.

### Contribuição Assíncrona vs Síncrona
**Decisão**: Assíncrona. O POST de contribuição acontece após o modelo responder, invisível ao usuário. O `useChronicleNarrativeChat` detecta o bloco `<wiki_extract>` na resposta filtrada e dispara o POST em background.

### Consolidação: Cache Materializado vs Query-time
**Decisão**: Cache materializado em `consolidated_cache`. Rebuild quando nova contribuição é aceita (não quarentined). Evita queries pesadas em cada page view. TTL de 1h para stale cache — se a consolidação não foi rebuilt, serve o cache antigo.

### Campos Canônicos: Schema Fixo vs Dinâmico
**Decisão**: Schema fixo com 9 campos. Extensível no futuro via migration, mas a v1 usa campos conhecidos para manter o consenso simples e o prompt enxuto.

---

## Verificação e Quality Gates

### Por Sprint

| Sprint | Gate de Qualidade |
|--------|------------------|
| 1 | `npm run typecheck` passa. Testes auth. Fluxo anon inalterado. |
| 2 | Testes contribute. Contribuição persiste em D1. Quarentena funciona. |
| 3 | Intent router classifica contribuições corretamente. Prompt gera perguntas naturais. |
| 4 | Página wiki renderiza. Consenso resolve corretamente. Chat recebe contexto. |
| 5 | Tiers calculados corretamente. Badges visíveis. Whitelist funciona. |

### Testes de Regressão Obrigatórios

Antes de cada merge:
```bash
npm run typecheck
npm run test
npm run test:smoke
```

### Testes Manuais Críticos

1. Abrir app sem Discord → tudo funciona igual ao atual
2. Conectar Discord → tier calculado, avatar visível
3. Contribuir via chat → bloco extraído, POST enviado, contribuição em D1
4. Abrir `/wiki/:slug` → dados consolidados renderizados
5. Contribuição anon → status quarentena
6. Contribuição OG → status published

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Discord API rate limits no callback | Média | Médio | Cache de guilds por 1h em KV |
| Prompt engineering do modo extrator | Alta | Alto | Iteração com coleções reais, testes manuais |
| Extração incorreta de `<wiki_extract>` | Média | Médio | Parser robusto com fallback, validação de schema |
| Consenso com poucos contribuidores | Alta | Baixo | Campos ficam em draft, transparência na UI |
| JWT secret rotation | Baixa | Alto | Documentar processo, planejar para v2 |
| D1 migrations em produção | Baixa | Alto | Testar local primeiro, sempre `IF NOT EXISTS` |

---

## Estimativa Total

| Sprint | Dias | Complexidade |
|--------|------|-------------|
| 1 — Identity | 3–4 | Média |
| 2 — Contributions | 3–4 | Média-Alta |
| 3 — Question Engine | 2–3 | Média |
| 4 — Consolidation + UI | 4–5 | Alta |
| 5 — OG Scoring | 2–3 | Média |
| **Total** | **14–19 dias** | — |

---

## Checklist Pré-Implementação

- [x] Criar Discord Application no Developer Portal
- [x] Configurar redirect URI: `http://localhost:5173/api/auth/callback` (dev)
- [x] `wrangler secret put DISCORD_CLIENT_ID` (configurado em `.dev.vars`)
- [x] `wrangler secret put DISCORD_CLIENT_SECRET` (configurado em `.dev.vars`)
- [x] `wrangler secret put JWT_SECRET` (configurado em `.dev.vars`)
- [ ] Identificar server IDs dos servers Ordinals para tier engine
- [ ] Definir whitelist genesis inicial

---

*Este documento é a referência canônica de implementação. Cada sprint será detalhado em tasks específicas conforme avançarmos.*
