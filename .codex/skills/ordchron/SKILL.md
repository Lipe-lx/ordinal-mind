---
name: ordinal-mind
description: >
  Implementa o produto Ordinal Mind — plataforma de Chronicle factual para colecionadores de Bitcoin Ordinals.
  Use esta skill sempre que o usuário pedir para desenvolver, modificar, ou expandir o Ordinal Mind.
  Cobre: Cloudflare Workers + Pages + KV, rastreador UTXO reverso via mempool.space, ordinals.com nativo,
  scraping de menções no X sem API key, BYOK agnóstico de provedor (Anthropic/OpenAI/Gemini),
  árvore temporal de eventos on-chain descentralizada, Chronicle Synthesizer e Chronicle card compartilhável.
---

# Ordinal Mind — Skill de Implementação

## O que é o produto

Ordinal Mind é um Chronicle factual para colecionadores de Bitcoin Ordinals. O usuário cola um
**inscription number** (ex: `4821`) ou um **endereço taproot** (`bc1p...`) e recebe:

1. Uma **árvore temporal** de todos os eventos verificáveis do ativo — genesis, transfers, menções no X
2. Uma **narrativa Chronicle** sintetizada por LLM a partir dos dados reais
3. Um **Chronicle card** compartilhável no X com imagem OG

Sem login, sem wallet connect, sem API paga. Todo o dado é público e imutável.

---

## Stack e decisões arquiteturais

| camada | tecnologia | motivo |
|---|---|---|
| Backend | Cloudflare Workers | V8 isolates, cold start ~0ms, HTMLRewriter nativo |
| Cache | Cloudflare KV | read-heavy, edge global, substituiu Supabase |
| Frontend | React + Cloudflare Pages | estático, deploy no mesmo projeto CF |
| On-chain data & Metadata | ordinals.com API | instância oficial do protocolo, fornece satpoint, txid, genesis fee, etc |
| Block timestamps & Transfers | mempool.space API (open) | timestamps reais + rastreador reverso de UTXOs para histórico de transferências |
| X mentions | DDG HTML scrape (sem API key) | `site:x.com` query, HTMLRewriter do CF |
| LLM synthesis | BYOK agnóstico de provedor | key do usuário no browser, nunca no servidor |

**Princípio central:** o Worker apenas agrega dados brutos públicos e cacheáveis. A síntese LLM
acontece client-side com a key do usuário. O servidor não toca nem armazena chaves de API.

**Atualização operacional (abril/2026):** no OrdinalMind, traits e rarity context do card vêm
primariamente de `ordinals.com` (CBOR) + overlays públicos (`satflow.com` e fallback `ord.net`).
A UniSat é usada como enriquecimento opcional de inscrição (charms/metaprotocol), não como fonte
principal de traits/rank.

---

## Estrutura do projeto

```
ordinal-mind/
├── src/
│   ├── worker/
│   │   ├── index.ts              # entrypoint do Worker, roteamento
│   │   ├── resolver.ts           # detecta tipo de input (inscription vs address)
│   │   ├── agents/
│   │   │   ├── mempool.ts        # fetch mempool.space (timestamps e UTXO crawler)
│   │   │   ├── ordinals.ts       # fetch ordinals.com (metadados brutos completos)
│   │   │   └── xsearch.ts        # scraping DDG → menções X
│   │   ├── timeline.ts           # merge + sort → ChronicleEvent[]
│   │   └── cache.ts              # KV read/write com TTL strategy
│   └── app/
│       ├── main.tsx              # entrypoint React
│       ├── pages/
│       │   ├── Home.tsx          # input + trigger scan
│       │   └── Chronicle.tsx     # árvore temporal + card
│       ├── components/
│       │   ├── TemporalTree.tsx  # visualização dos eventos
│       │   ├── ChronicleCard.tsx # card compartilhável
│       │   ├── BYOKModal.tsx     # input da key do usuário
│       │   └── SatBadge.tsx      # exibe rarity class do sat
│       └── lib/
│           ├── byok/
│           │   ├── index.ts      # detecta provider, instancia adapter
│           │   ├── anthropic.ts  # adapter Anthropic
│           │   ├── openai.ts     # adapter OpenAI
│           │   └── gemini.ts     # adapter Gemini
│           └── types.ts          # tipos compartilhados
├── wrangler.toml
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
cache.ts → KV lookup por inscription_id
  ↓ cache miss
ordinals.ts → fetch metadata principal (satpoint, genesis, etc)
  ↓
Promise.all([
  mempool (UTXO traceTransfers),
  xsearch,
  collection overlays (satflow/ord.net),
  unisat inscription info (opcional)
])   ← paralelo
  ↓
timeline.ts → merge, sort por timestamp, tipifica
  ↓
cache.ts → KV write com TTL por tipo de evento
  ↓
Response.json(events)   ← Worker retorna ao browser
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
  | "genesis"         // inscrição criada
  | "transfer"        // mudou de carteira
  | "sale"            // vendido num marketplace
  | "x_mention"       // post encontrado no X via DDG
  | "collection_link" // pertence a uma coleção (parent inscription)
  | "recursive_ref"   // referencia outra inscrição
  | "sat_context"     // dados de raridade do sat

export type SatRarity =
  | "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic"

export interface ChronicleEvent {
  id: string                           // uuid gerado no timeline builder
  timestamp: string                    // ISO8601 derivado do bloco BTC
  block_height: number
  event_type: EventType
  source: {
    type: "onchain" | "web"
    ref: string                        // txid ou URL
  }
  description: string                  // frase curta factual
  metadata: Record<string, unknown>
}

export interface InscriptionMeta {
  inscription_id: string              // hex hash com sufixo i0
  inscription_number: number
  sat: number
  sat_rarity: SatRarity
  content_type: string
  content_url: string
  genesis_block: number
  genesis_timestamp: string
  genesis_fee: number
  owner_address: string
  collection?: {
    parent_inscription_id: string
    name?: string
  }
  recursive_refs?: string[]           // outros inscription IDs referenciados
}

export interface Chronicle {
  inscription_id: string
  meta: InscriptionMeta
  events: ChronicleEvent[]
  cached_at: string
  narrative?: string                   // preenchido client-side pelo LLM
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
- Menções X → TTL de 24 horas
- O scraping do DDG tem rate limit implícito: máximo 1 request por 3 segundos por IP,
  use a fila descrita em `references/data-sources.md`
- Sempre retornar `events` mesmo se o Chronicle Synthesizer falhar — a árvore temporal
  de eventos brutos é o produto mínimo viável, a narrativa é enhancement
- BYOK: se o usuário não tiver key, renderizar a árvore de eventos sem narrativa.
  Nunca bloquear a experiência por falta de key LLM
