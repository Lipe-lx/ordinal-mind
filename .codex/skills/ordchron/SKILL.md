---
name: ordinal-mind
description: >
  Implementa o produto Ordinal Mind — plataforma de Chronicle factual para colecionadores de Bitcoin Ordinals.
  Use esta skill sempre que o usuário pedir para desenvolver, modificar, ou expandir o Ordinal Mind.
  Cobre: Cloudflare Workers + Pages + KV, rastreador UTXO reverso via mempool.space, ordinals.com nativo,
  pipeline de pesquisa client-side (MCP) agnóstico de provedor (Anthropic/OpenAI/Gemini/OpenRouter),
  árvore temporal de eventos on-chain descentralizada, Chronicle Synthesizer e Chronicle card compartilhável.
---

# Ordinal Mind — Skill de Implementação

## O que é o produto

Ordinal Mind é um Chronicle factual para colecionadores de Bitcoin Ordinals. O usuário cola um
**inscription number** (ex: `4821`) ou um **endereço taproot** (`bc1p...`) e recebe:

1. Uma **árvore temporal** de todos os eventos verificáveis do ativo — genesis, transfers, metadados
2. Uma **narrativa Chronicle** sintetizada por LLM, enriquecida por um pipeline de pesquisa client-side
3. Um **Chronicle card** compartilhável no X com imagem OG

Sem login, sem wallet connect, sem API paga. Todo o dado é público e imutável.

---

## Stack e decisões arquiteturais

| camada | tecnologia | motivo |
|---|---|---|
| Backend | Cloudflare Workers | V8 isolates, cold start ~0ms, HTMLRewriter nativo, SSE streaming |
| Cache | Cloudflare KV | read-heavy, edge global, cache de metadados e timelines |
| DB | Cloudflare KV | persistência leve de validações entre fontes |
| Frontend | React + Cloudflare Pages | estático, deploy no mesmo projeto CF, Motion para animações |
| On-chain data | ordinals.com API | instância oficial do protocolo, fornece satpoint, genesis, metadados CBOR |
| Transfers | mempool.space API | timestamps reais + rastreador forward de UTXOs para histórico |
| Indexadores | UniSat API | enriquecimento de charms, metadados de mercado e raridade |
| Research | SearXNG / Wiki / DDG | pipeline de pesquisa web para lore de coleções e sinais sociais |
| BYOK | Browser Providers | key do usuário no browser, síntese client-side via Anthropic/OpenAI/Gemini/OpenRouter |

**Princípio central:** o Worker apenas agrega dados brutos públicos e cacheáveis. A síntese LLM
acontece client-side com a key do usuário. O servidor não toca nem armazena chaves de API.

---

## Estrutura do projeto

```
ordinal-mind/
├── src/
│   ├── worker/
│   │   ├── index.ts              # entrypoint do Worker, SSE streaming, orquestração
│   │   ├── resolver.ts           # normalização de input (id, number, address)
│   │   ├── agents/
│   │   │   ├── mempool.ts        # fetch mempool.space (forward transfer tracking)
│   │   │   ├── ordinals.ts       # fetch ordinals.com (metadata + CBOR)
│   │   │   ├── unisat.ts         # UniSat Open API (indexer & rarity)
│   │   │   ├── collections.ts    # context de coleções (Satflow, Ord.net)
│   │   │   ├── webResearch.ts    # pesquisa web (SearXNG, Wiki, DDG)
│   │   │   └── mentions/         # sinais sociais e Google Trends
│   │   ├── timeline.ts           # merge + sort → ChronicleEvent[]
│   │   ├── rarity.ts             # motor de cálculo de raridade
│   │   ├── validation.ts         # validação cruzada entre indexadores
│   │   ├── db.ts                 # storage de validações
│   │   └── cache.ts              # KV read/write com TTL strategy
│   └── app/
│       ├── main.tsx              # entrypoint React
│       ├── pages/
│       │   ├── Home.tsx          # input + trigger scan
│       │   └── Chronicle.tsx     # árvore temporal + card + síntese
│       ├── components/
│       │   ├── TemporalTree.tsx  # visualização dos eventos
│       │   ├── ChronicleCard.tsx # card interativo 3D
│       │   └── BYOK/             # componentes de configuração de LLM
│       └── lib/
│           ├── byok/             # adapters de provedores (Anthropic, Gemini, etc)
│           ├── types.ts          # tipos compartilhados
│           └── brandLinks.tsx    # links de marcas e redes sociais
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

---

## Fluxo de dados (happy path)

```
INPUT (inscription id ou address)
  ↓
resolver.ts → detecta tipo, normaliza
  ↓
cache.ts → KV lookup (se não for streaming)
  ↓
SSE Streaming (index.ts)
  ├── Phase 1: Metadata (ordinals.ts + CBOR)
  ├── Phase 2: Transfers (mempool.ts forward trace)
  ├── Phase 3: Mentions & Lore (mentions/ + webResearch.ts)
  └── Phase 4: Indexer Enrichment (unisat.ts + rarity.ts)
  ↓
timeline.ts → merge, sort, tipifica
  ↓
validation.ts → cross-check entre fontes → db.ts
  ↓
cache.ts → KV write final
  ↓
browser: LLM BYOK → Chronicle Synthesizer → narrativa
  ↓
ChronicleCard + TemporalTree renderizados
```

---

## Tipos centrais

```typescript
// src/app/lib/types.ts

export type EventType =
  | "genesis" | "transfer" | "sale" | "social_mention"
  | "collection_link" | "recursive_ref" | "sat_context" | "trait_context"

export interface Chronicle {
  inscription_id: string
  meta: InscriptionMeta
  events: ChronicleEvent[]
  collector_signals: CollectorSignals
  collection_context: CollectionContext
  web_research?: WebResearchContext
  unisat_enrichment?: UnisatEnrichment
  validation?: DataValidationResult
  cached_at: string
}

export interface InscriptionMeta {
  inscription_id: string
  inscription_number: number
  sat: number
  sat_rarity: SatRarity
  content_type: string
  genesis_txid: string
  genesis_block: number
  genesis_timestamp: string
  owner_address: string
  charms?: string[]
}

export interface CollectorSignals {
  attention_score: number
  sentiment_label: SentimentLabel
  confidence: CollectorSignalConfidence
  evidence_count: number
  provider_breakdown: Record<string, number>
}
```

---

## Referências detalhadas

Para implementar cada camada, leia os arquivos de referência na ordem necessária:

| arquivo | quando ler |
|---|---|
| `references/cloudflare.md` | primeiro — setup do projeto, wrangler, KV bindings |
| `references/data-sources.md` | ao implementar os agents de fetch (ordinals, mempool, xsearch) |
| `references/byok.md` | ao implementar o Chronicle Synthesizer client-side |
| `references/frontend.md` | ao construir a UI — árvore temporal e Chronicle card |

---

## Ordem de implementação recomendada

1. Setup Cloudflare (leia `references/cloudflare.md`)
2. Tipos em `src/app/lib/types.ts`
3. `resolver.ts` — input validation
4. Os agents de dados (ordinals, mempool, xsearch)
5. `timeline.ts` — merge e sort
6. `cache.ts` — KV strategy
7. `worker/index.ts` — routing + orquestração
8. Adapters BYOK (leia `references/byok.md`)
9. Frontend React (leia `references/frontend.md`)

---

## Regras críticas

- O Worker **nunca** recebe, loga ou armazena chaves de LLM do usuário
- Dados de genesis (imutáveis) → TTL de 30 dias no KV
- Dados de transfer → TTL de 1 hora
- As ferramentas de pesquisa (Brave, Exa, Perplexity) são executadas **client-side** pelo LLM para coletar contexto de coleção
- Sempre retornar `events` mesmo se o Chronicle Synthesizer falhar — a árvore temporal
  de eventos brutos é o produto mínimo viável, a narrativa é enhancement
- BYOK: se o usuário não tiver key, renderizar a árvore de eventos sem narrativa.
  Nunca bloquear a experiência por falta de key LLM
