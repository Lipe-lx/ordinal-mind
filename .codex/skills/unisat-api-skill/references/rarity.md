# Rarity no OrdinalMind — Nao via UniSat

## Regra oficial

No OrdinalMind, o card de traits/rarity usa pipeline factual desta ordem:

1. `ordinals.com/r/metadata/{id}` (CBOR traits)
2. `satflow.com/ordinal/{id}` (incluindo payload escapado `__next_f`)
3. `ord.net` (`verifiedGalleryTraitGroups`) como fallback

UniSat nao e fonte primaria de traits/rank para o card.

## Por que esta regra existe

- Consistencia observada em colecoes de mercado (ex.: Quantum Cats) ocorre melhor
  no overlay Satflow/ord.net + CBOR.
- UniSat pode vir sem attributes ou com estrutura variavel por colecao/epoca.
- O produto precisa de determinismo e degradacao previsivel.

## Consequencia pratica para implementacao

- Nao amarrar renderizacao de traits ao sucesso da chamada UniSat.
- Nao inferir rank global da colecao por UniSat no fluxo principal.
- Se UniSat vier com attributes, tratar como dado auxiliar, nunca como unica verdade.
