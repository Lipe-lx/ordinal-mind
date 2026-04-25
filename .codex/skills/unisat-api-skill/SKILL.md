---
name: unisat-api
description: >
  Skill de integracao UniSat para o OrdinalMind no perfil real de producao:
  usar principalmente /v1/indexer/inscription/info para charms, sat e metaprotocol,
  com rate-limit/backoff e degradacao graciosa. Acione quando houver trabalho em
  UNISAT_API_KEY, endpoint inscription/info, charms, metaprotocol, ou diagnostico
  do bloco "unisat" no stream. Nao usar esta skill como fonte principal de traits
  ou rarity rank do card; no OrdinalMind isso vem de Satflow + ord.net + CBOR.
---

# UniSat API — Perfil Real do OrdinalMind

## Escopo atual (o que fazemos hoje)

No produto em producao, UniSat e usada como enriquecimento opcional de inscricao:
- endpoint principal: `GET /v1/indexer/inscription/info/{inscriptionId}`
- campos consumidos: `charms`, `sat`, `metaprotocol`, `contentLength`

Nao tratamos UniSat como fonte principal para:
- traits/attributes do card de raridade
- rarity rank/supply de colecao
- frequencias globais de trait

A fonte factual de traits/rarity no fluxo principal e:
1. CBOR em `ordinals.com/r/metadata/{id}`
2. overlay de `satflow.com/ordinal/{id}`
3. fallback `ord.net` (`verifiedGalleryTraitGroups`)

## Quando usar esta skill

Use esta skill quando a tarefa envolver:
- debug de `UNISAT_API_KEY`
- robustez de chamada UniSat (`429`, retries, backoff)
- parsing de `inscription/info`
- harmonizacao de `charms`/`metaprotocol` no payload do Chronicle
- mensagens de progresso da fase `unisat` no stream

## Contrato de implementacao

1. Sempre tratar UniSat como opcional e nao bloqueante.
2. Falha UniSat nunca deve quebrar timeline factual.
3. Validar envelope `code === 0` antes de usar `data`.
4. Em `429`, aplicar retry com backoff exponencial.
5. Nao persistir segredo de API key.
6. Nao prometer traits/rank vindos da UniSat no UX do card.

## Checklist rapido para PRs

- [ ] A chamada UniSat esta restrita ao endpoint de inscricao (perfil atual)?
- [ ] Erros `429` e falhas de rede estao com degradacao graciosa?
- [ ] `source_catalog` marca UniSat apenas como indexador complementar?
- [ ] A arvore temporal continua igual com UniSat indisponivel?
- [ ] Documentacao do trecho evita afirmar que UniSat e fonte primaria de traits?

## Referencias da skill

- `references/endpoints.md` — endpoint realmente usado hoje + endpoints fora do escopo atual
- `references/patterns.md` — padroes de retry/throttle/degradacao
- `references/rarity.md` — regra oficial: rarity nao e derivada de UniSat no OrdinalMind
