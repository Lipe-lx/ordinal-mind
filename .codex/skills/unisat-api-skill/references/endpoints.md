# UniSat Endpoints — Perfil do OrdinalMind (Abril 2026)

## Endpoint ativo em producao

### GET /v1/indexer/inscription/info/{inscriptionId}
Base: `https://open-api.unisat.io`

Headers:
- `Authorization: Bearer <UNISAT_API_KEY>`
- `Accept: application/json`

Envelope esperado:
```json
{
  "code": 0,
  "msg": "ok",
  "data": { ... }
}
```

Campos consumidos pelo OrdinalMind:
- `charms`
- `sat`
- `metaprotocol`
- `contentLength`

Campos que podem existir, mas NAO sao fonte primaria de rarity no produto:
- `attributes`
- `properties.attributes`

## Endpoints fora do escopo atual (nao usados no fluxo padrao)

- `/v3/market/collection/auction/collection_inscriptions`
- `/v3/market/collection/auction/inscription_info`
- `/v3/market/collection/auction/inscription_info_list`
- outros endpoints de marketplace

Esses endpoints podem ser usados em experimentacao isolada, mas nao fazem parte do
contrato principal do OrdinalMind para traits/rank do card.

## Boas praticas de chamada

1. Se `code !== 0`, tratar como resposta vazia e seguir pipeline.
2. Se HTTP `429`, retry com backoff.
3. Se timeout/falha de rede, logar e continuar sem bloquear timeline.
4. Nao assumir que `attributes` estara presente ou consistente entre colecoes.
