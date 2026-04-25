# Data Sources — Ordinal Mind (estado real, Abril 2026)

Este documento substitui orientacoes antigas e define a fonte de verdade atual do pipeline.

## Principio central
- Timeline factual e verificavel primeiro.
- Nenhum endpoint isolado pode derrubar o Chronicle.
- Traits/raridade de item NAO dependem de UniSat no fluxo principal.

---

## Matriz de fontes (producao)

| Dominio | Fonte principal | Papel no produto | Observacao |
|---|---|---|---|
| Inscricao on-chain | `ordinals.com` | metadados base, sat, owner, genesis, content, CBOR | fonte canonicamente prioritaria para metadados |
| Historico de transferencias | `mempool.space` | rastreio de UTXO/transfers/sales | degrade graciosamente se falhar |
| Traits e contexto de colecao | `satflow.com` + `ord.net` | atributos do item, supply/rank quando disponivel, contexto de colecao | fonte principal de traits no produto hoje |
| Charms/metaprotocol | `open-api.unisat.io` | enriquecimento opcional de inscricao (charms, sat, metaprotocol) | NAO fonte primaria de traits/rank |
| Menções sociais | `html.duckduckgo.com` (`site:x.com`) | descoberta publica de menções no X | scraping fragil, nunca bloqueia pipeline |

---

## Regras de precedencia para traits/rarity

Ao montar `unisat_enrichment.rarity` (nome historico de campo), usar esta ordem:

1. `ordinals.com/r/metadata/{id}` (CBOR traits) quando houver traits validos.
2. Overlay do `satflow.com` para a inscricao (`/ordinal/{id}`), incluindo payloads escapados de `__next_f`.
3. Fallback de `ord.net` via `verifiedGalleryTraitGroups` quando Satflow nao trouxer traits.
4. Se nenhuma fonte trouxer traits: retornar sem `trait_context` e manter restante do Chronicle.

Observacoes:
- `rarityRank` pode ser `0` em algumas colecoes; nao tratar `0` como erro automaticamente.
- Arrays escapados (ex.: `\\"attributes\\":[...]`) devem ser parseados corretamente.
- Nao inventar traits quando a fonte vier vazia.

---

## UniSat no Ordinal Mind (escopo atual)

Uso em producao:
- Endpoint: `GET /v1/indexer/inscription/info/{inscriptionId}`
- Campos usados: `charms`, `sat`, `metaprotocol`, `contentLength`.

Nao usar como fonte principal para:
- `attributes/traits` de item para card de raridade.
- rank de raridade da colecao.
- frequencias globais de traits da colecao.

Se UniSat falhar:
- continuar timeline sem bloqueio.
- manter arvore temporal factual e fontes publicas ativas.

---

## Diagnostico recomendado (quando traits zeram)

1. Verificar logs de overlay:
- `satflow_overlay_parsed.rarity_trait_count`
- `ord_net_overlay_parsed.rarity_trait_count`
- `overlay_resolution.selected_rarity_trait_count`

2. Verificar resumo de pipeline:
- `stream_rarity_pipeline_summary.cbor_trait_count`
- `stream_rarity_pipeline_summary.satflow_trait_count`
- `stream_rarity_pipeline_summary.rarity_trait_count`

3. Se Satflow tiver payload escapado e trait count continuar 0:
- revisar parser de arrays balanceados em string escapada (`__next_f`).

4. Confirmar que ord.net pode retornar `traits: []` para algumas inscricoes (isso e esperado).

---

## Requisitos de resiliencia

- Falha em X mentions nao invalida on-chain.
- Falha em UniSat nao invalida traits de Satflow/ord.net.
- Falha em Satflow deve tentar ord.net fallback.
- Falha em cache deve tentar fetch fresco.
- Pipeline sempre retorna o maximo factual possivel.

---

## Contrato de UX

A UI deve sempre comunicar:
- o que foi encontrado,
- de qual fonte veio,
- quando nao houve dados de trait em alguma fonte,
- sem simular certeza quando os overlays vierem vazios.
