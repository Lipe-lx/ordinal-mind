---
name: unisat-api
description: >
  Skill completa para uso da UniSat Open API com foco em extração de dados de inscrições Ordinals,
  coleções e traits de atributos para cálculo de raridade. Use quando o usuário precisar consultar
  dados de inscrições Bitcoin, itens de coleções Ordinals, atributos/traits de NFTs, floor price,
  atividade de mercado, balanços de endereço ou quiser construir um screener/ranker de raridade.
  Cobre autenticação, paginação eficiente, paralelismo seguro, cache local e cálculo de rarity rank.
---

# UniSat Open API — Skill Completa

## Referências rápidas
- Swagger interativo: `https://open-api.unisat.io`
- Docs completos: `https://github.com/unisat-wallet/unisat-dev-docs`
- Developer Center: `https://developer.unisat.io`

Para payloads detalhados e exemplos de resposta de cada módulo, leia os arquivos em `references/`:
- `references/endpoints.md` — todos os endpoints com payloads e campos de resposta
- `references/rarity.md` — algoritmos de rarity score e exemplos de código
- `references/patterns.md` — padrões de otimização, paginação e cache

---

## 1. Setup e Autenticação

### Base URLs
```
Mainnet:        https://open-api.unisat.io
Testnet:        https://open-api-testnet.unisat.io
Fractal Mainnet: https://open-api-fractal.unisat.io
```

### Auth Header (obrigatório em todas as chamadas)
```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Planos (developer.unisat.io)
| Plano | Rate limit | Custo |
|-------|-----------|-------|
| Free | 5 req/s, 2.000/dia | Gratuito |
| Specialist | ~100 req/s | Pago (BTC ou PayPal) |
| Enterprise | Customizado | Contato |
| Pay-as-you-go | Flexível | Por uso |

> Sem API key: acesso possível mas com rate limit severo e sem garantia de resposta em alta carga. **Sempre use key**.

---

## 2. Padrão de Resposta Universal

Todas as respostas seguem o envelope:
```json
{
  "code": 0,       // 0 = sucesso, != 0 = erro
  "msg": "ok",
  "data": { ... }  // payload real
}
```

**Sempre verifique `code === 0` antes de processar `data`.**

---

## 3. Endpoints Essenciais — Inscrições

### 3.1 Info completa de uma inscrição
```
GET /v1/indexer/inscription/info/{inscriptionId}
```
**Retorna tudo sobre uma inscrição:** `inscriptionId`, `inscriptionNumber`, `address` atual, `contentType`, `contentLength`, `height` de criação, `timestamp`, `genesisTransaction`, `sat` (número do satoshi), `offset`, `charms`, `metaprotocol` e — quando a coleção fornece — `attributes[]` com traits.

Exemplo de chamada:
```python
GET https://open-api.unisat.io/v1/indexer/inscription/info/abc123...i0
Authorization: Bearer {KEY}
```

### 3.2 Inscrições de um endereço (com cursor)
```
GET /v1/indexer/address/{address}/inscription-data
  ?cursor=0&size=100
```
Retorna `list[]` de inscrições + `total`. Pagine via `cursor` incrementando por `size`.

### 3.3 UTXOs de inscrições em um endereço
```
GET /v1/indexer/address/{address}/inscription-utxo
  ?cursor=0&size=100
```
Útil para descobrir quais UTXOs contêm inscrições (para PSBT, compra/venda).

---

## 4. Endpoints Essenciais — Coleções e Marketplace

### 4.1 Estatísticas de uma coleção (floor, volume, supply)
```
POST /v3/market/collection/auction/collection_statistic
Body: { "collectionId": "my-collection-id" }
```
Resposta inclui: `floorPrice`, `btcValue`, `pricePercent` (variação 24h), `listed`, `total`, `supply`, `verification`, `twitter`, `discord`, `website`.

### 4.2 Lista de coleções com ranking
```
POST /v3/market/collection/auction/collection_statistic_list
Body: {
  "filter": { "timeType": "1d", "name": "optional-search" },
  "start": 0,
  "limit": 20
}
```
`timeType`: `"1d"` | `"7d"` | `"30d"`. Traz ranking por volume com os mesmos campos do 4.1.

### 4.3 Inscrições de uma coleção (paginado) — **endpoint central para rarity**
```
POST /v3/market/collection/auction/collection_inscriptions
Body: {
  "collectionId": "my-collection-id",
  "address": "opcional-filtrar-por-dono",
  "start": 0,
  "limit": 100
}
```
Cada item retorna: `inscriptionId`, `inscriptionNumber`, `address`, `price`, `status` (listed/unlisted), `attributes[]` com `{ trait_type, value }`.

> **Este é o endpoint que alimenta o cálculo de rarity.** Pagine até esgotar `total`.

### 4.4 Info de inscrição em contexto de marketplace
```
POST /v3/market/collection/auction/inscription_info
Body: { "inscriptionId": "abc123...i0" }
```
Complementa `/v1/indexer/inscription/info` com: `auctionId`, `price`, `unitPrice`, `collectionId`, `collectionItemName`, `attributes[]`, `contentType`, `contentBody`.

### 4.5 Info de múltiplas inscrições em batch
```
POST /v3/market/collection/auction/inscription_info_list
Body: {
  "inscriptionIds": ["id1", "id2", ..., "idN"]
}
```
**Use este endpoint para reduzir chamadas.** Limite prático: ~100 ids por request.

### 4.6 Listings do marketplace com filtros
```
POST /v3/market/collection/auction/list
Body: {
  "filter": {
    "nftType": "collection",
    "collectionId": "my-collection-id",
    "minPrice": 1000,   // sats
    "maxPrice": 50000,
    "nftConfirm": true  // só confirmados
  },
  "sort": {
    "unitPrice": 1,         // 1 = ASC
    "inscriptionNumber": 1
  },
  "start": 0,
  "limit": 100
}
```

### 4.7 Histórico de atividade (vendas, listings, delists)
```
POST /v3/market/collection/auction/actions
Body: {
  "filter": {
    "collectionId": "my-collection-id",
    "event": "Sold"  // "Listed" | "Delisted" | "Sold"
  },
  "start": 0,
  "limit": 100
}
```
Cada evento traz: `event`, `price`, `from`, `to`, `timestamp`, `attributes[]`.

---

## 5. Estratégia de Extração Eficiente

### Regra de ouro: mínimo de chamadas, máximo de dados

```
SITUAÇÃO → ESTRATÉGIA
─────────────────────────────────────────────────────────────────
Dados completos de 1 inscrição   → GET /v1/indexer/inscription/info/{id}
Dados de até 100 inscrições      → POST inscription_info_list (batch)
Todos os itens de uma coleção    → POST collection_inscriptions (paginado)
Floor + stats da coleção         → POST collection_statistic (1 call)
Listings listados agora          → POST list com filtro collectionId
Vendas recentes                  → POST actions com event="Sold"
```

### Fluxo para análise completa de uma coleção

```
1. collection_statistic  →  supply total, floor, verificação
2. collection_inscriptions (paginado)  →  todos os items + attributes
3. Calcular rarity rank localmente (ver references/rarity.md)
4. Opcional: inscription_info_list em batches para dados de mercado
```

**Não é preciso chamar `/v1/indexer/inscription/info` individualmente** se `collection_inscriptions` já retornar os traits — economiza N chamadas.

---

## 6. Paginação Correta

Todos os endpoints paginados usam `start` (offset) + `limit` (page size). Máximo sugerido: `limit=100`.

```python
def paginate_all(post_fn, body, limit=100):
    """Coleta todos os registros de um endpoint paginado."""
    results = []
    start = 0
    while True:
        body["start"] = start
        body["limit"] = limit
        resp = post_fn(body)
        items = resp["data"]["list"]
        results.extend(items)
        total = resp["data"]["total"]
        start += len(items)
        if start >= total or not items:
            break
    return results
```

---

## 7. Rate Limiting e Retry

```python
import time, requests

def call_with_retry(fn, max_retries=3, backoff=1.5):
    for attempt in range(max_retries):
        try:
            return fn()
        except requests.HTTPError as e:
            if e.response.status_code == 429:
                wait = backoff ** attempt
                time.sleep(wait)
            else:
                raise
    raise Exception("Max retries exceeded")
```

No plano free (5 req/s), use `time.sleep(0.2)` entre chamadas sequenciais ou limite concorrência a 4 threads.

---

## 8. Campos de Resposta — O que cada inscrição entrega

Ao combinar `/v1/indexer/inscription/info` com `inscription_info` do marketplace:

| Campo | Fonte | Descrição |
|-------|-------|-----------|
| `inscriptionId` | Indexer | Hash único da inscrição |
| `inscriptionNumber` | Indexer | Número sequencial global |
| `address` | Indexer | Dono atual |
| `contentType` | Indexer | MIME type (image/png, text/plain…) |
| `contentLength` | Indexer | Tamanho do conteúdo em bytes |
| `height` | Indexer | Bloco de criação |
| `timestamp` | Indexer | Unix timestamp de criação |
| `sat` | Indexer | Número do satoshi (para raridade de sat) |
| `genesisTransaction` | Indexer | TXID de criação |
| `charms` | Indexer | Propriedades especiais do sat (vintage, uncommon…) |
| `metaprotocol` | Indexer | Ex: "brc-20", null para Ordinals puros |
| `attributes[]` | Market / Collection | `[{ trait_type, value }]` — traits NFT |
| `collectionId` | Market | ID da coleção |
| `collectionItemName` | Market | Nome do item na coleção |
| `price` | Market | Preço listado em sats (0 se não listado) |
| `auctionId` | Market | ID do listing ativo |

### Charms possíveis (raridade nativa do protocolo Ordinals)
`coin` | `cursed` | `epic` | `legendary` | `lost` | `mythic` | `nineball` | `rare` | `reinscription` | `uncommon` | `unbound` | `vindicated` | `vintage`

---

## 9. Cálculo de Rarity Rank

Ver `references/rarity.md` para implementação completa. Resumo do algoritmo:

```python
# Para cada inscrição, somar: Σ (1 / frequência_relativa_de_cada_trait)
# Quanto maior o score, mais raro o item.

def compute_rarity(inscriptions: list[dict]) -> list[dict]:
    total = len(inscriptions)
    # 1. Contar frequência de cada (trait_type, value)
    freq = {}
    for item in inscriptions:
        for attr in item.get("attributes", []):
            key = (attr["trait_type"], attr["value"])
            freq[key] = freq.get(key, 0) + 1
    # 2. Score = soma de (1 / freq_relativa) por trait
    for item in inscriptions:
        score = 0.0
        for attr in item.get("attributes", []):
            key = (attr["trait_type"], attr["value"])
            score += total / freq[key]
        item["rarityScore"] = round(score, 4)
    # 3. Rank por score decrescente
    inscriptions.sort(key=lambda x: x["rarityScore"], reverse=True)
    for rank, item in enumerate(inscriptions, 1):
        item["rarityRank"] = rank
    return inscriptions
```

---

## 10. Erros Comuns

| Código HTTP | `code` na resp | Causa | Solução |
|-------------|---------------|-------|---------|
| 401 | - | API key ausente/inválida | Verificar header Authorization |
| 429 | - | Rate limit excedido | Backoff exponencial |
| 200 | != 0 | Erro de negócio | Ver campo `msg` para detalhes |
| 200 | 0, data vazio | Coleção/inscrição não indexada | Verificar collectionId |

---

## 11. Exemplo End-to-End (Python)

```python
import requests, time

API_KEY = "sua_key_aqui"
BASE_URL = "https://open-api.unisat.io"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

def get(path):
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS)
    r.raise_for_status()
    d = r.json()
    assert d["code"] == 0, d["msg"]
    return d["data"]

def post(path, body):
    r = requests.post(f"{BASE_URL}{path}", json=body, headers=HEADERS)
    r.raise_for_status()
    d = r.json()
    assert d["code"] == 0, d["msg"]
    return d["data"]

# 1. Stats da coleção
stats = post("/v3/market/collection/auction/collection_statistic",
             {"collectionId": "noderunners"})
print(f"Supply: {stats['supply']} | Floor: {stats['floorPrice']} sats")

# 2. Buscar todos os itens com traits (paginado)
all_items = []
start = 0
while True:
    data = post("/v3/market/collection/auction/collection_inscriptions",
                {"collectionId": "noderunners", "start": start, "limit": 100})
    all_items.extend(data["list"])
    if start + 100 >= data["total"]:
        break
    start += 100
    time.sleep(0.2)  # respeitar rate limit free tier

# 3. Calcular rarity
def compute_rarity(items):
    n = len(items)
    freq = {}
    for item in items:
        for a in item.get("attributes", []):
            k = (a["trait_type"], a["value"])
            freq[k] = freq.get(k, 0) + 1
    for item in items:
        item["rarityScore"] = sum(n / freq[(a["trait_type"], a["value"])]
                                  for a in item.get("attributes", []))
    items.sort(key=lambda x: x["rarityScore"], reverse=True)
    for i, item in enumerate(items, 1):
        item["rarityRank"] = i
    return items

ranked = compute_rarity(all_items)
print(f"Top 5 mais raros:")
for item in ranked[:5]:
    print(f"  #{item['rarityRank']} {item['inscriptionId'][:20]}... score={item['rarityScore']:.2f}")
```

---

## 12. Notas Importantes

- **`collectionId`** é o slug interno da UniSat — diferente do nome de exibição. Descubra via `collection_statistic_list` filtrando por nome ou via marketplace web.
- A UniSat **não expõe rarity rank pré-computado**: você calcula localmente.
- Traits só existem se a coleção foi inscrita com metadados de atributos (padrão `meta.attributes[]`). Coleções antigas podem não ter.
- Para **Fractal Bitcoin**, trocar o host para `open-api-fractal.unisat.io` — mesmos endpoints.
- O campo `sat` permite cálculo de **sat rarity** (paleozoico, vintage, uncommon block, pizza sat etc.) independente dos traits da coleção.
