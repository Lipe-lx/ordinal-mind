# UniSat API — Referência Completa de Endpoints

## Base URLs
- **Mainnet:** `https://open-api.unisat.io`
- **Testnet:** `https://open-api-testnet.unisat.io`
- **Fractal:** `https://open-api-fractal.unisat.io`

Auth em todas: `Authorization: Bearer YOUR_API_KEY`

---

## MÓDULO: Indexer — Blockchain

### GET /v1/indexer/blockchain/info
Informações gerais da chain (último bloco, altura, etc.)

**Resposta `data`:**
```json
{
  "chain": "mainnet",
  "blocks": 890123,
  "bestBlockHash": "000000...",
  "medianTime": 1710000000
}
```

---

## MÓDULO: Indexer — Inscrições

### GET /v1/indexer/inscription/info/{inscriptionId}
Dados completos de uma inscrição única.

**Path param:** `inscriptionId` — ex: `abc123...i0`

**Resposta `data`:**
```json
{
  "inscriptionId": "abc123...i0",
  "inscriptionNumber": 42000,
  "address": "bc1p...",
  "outputValue": 546,
  "contentType": "image/png",
  "contentLength": 12345,
  "contentPreview": "data:image/png;base64,...",
  "height": 840000,
  "timestamp": 1714000000,
  "genesisTransaction": "txid...",
  "location": "txid:vout:offset",
  "output": "txid:vout",
  "offset": 0,
  "sat": 1234567890,
  "satributes": ["uncommon"],
  "charms": ["uncommon"],
  "metaprotocol": null,
  "brc20": null,
  "properties": {
    "attributes": [
      { "trait_type": "Background", "value": "Blue Sky" },
      { "trait_type": "Body", "value": "Gold" }
    ]
  }
}
```

**Nota:** `properties.attributes` ou `attributes` (depende da versão do endpoint) — sempre checar ambos.

---

### GET /v1/indexer/address/{address}/inscription-data
Inscrições paginadas de um endereço.

**Query params:** `cursor=0&size=100`

**Resposta `data`:**
```json
{
  "total": 500,
  "cursor": 100,
  "list": [
    {
      "inscriptionId": "...",
      "inscriptionNumber": 42000,
      "address": "bc1p...",
      "contentType": "image/png",
      "timestamp": 1714000000,
      "height": 840000,
      "offset": 0,
      "outputValue": 546
    }
  ]
}
```

**Paginação:** usar `cursor` retornado + incrementar por `size`. Para endereços com muitas inscrições (>1000), use o cursor retornado em vez de calcular offset manualmente.

---

### GET /v1/indexer/address/{address}/inscription-utxo
UTXOs que contêm inscrições (com valor e location).

**Query params:** `cursor=0&size=100`

**Resposta `data`:**
```json
{
  "total": 50,
  "cursor": 50,
  "utxo": [
    {
      "txid": "...",
      "vout": 0,
      "satoshi": 546,
      "scriptType": "P2TR",
      "scriptPk": "...",
      "codeType": 1,
      "address": "bc1p...",
      "height": 840000,
      "idx": 0,
      "isOpInRBF": false,
      "inscriptions": [
        {
          "inscriptionId": "...i0",
          "inscriptionNumber": 42000,
          "contentType": "image/png",
          "offset": 0
        }
      ]
    }
  ]
}
```

---

### GET /v1/indexer/address/{address}/balance
Saldo BTC de um endereço.

**Resposta `data`:**
```json
{
  "address": "bc1p...",
  "satoshi": 1000000,
  "pendingSatoshi": 0,
  "utxoCount": 5
}
```

---

## MÓDULO: Collection Marketplace

Host: `open-api.unisat.io` — todos são POST.

---

### POST /v3/market/collection/auction/collection_statistic
Stats de uma coleção específica.

**Request:**
```json
{ "collectionId": "noderunners" }
```

**Resposta `data`:**
```json
{
  "collectionId": "noderunners",
  "name": "NodeRunners",
  "desc": "...",
  "icon": "https://...",
  "iconContentType": "image/png",
  "btcValue": 12345678,
  "floorPrice": 50000,
  "pricePercent": 5.2,
  "listed": 120,
  "total": 1000,
  "supply": 10000,
  "twitter": "https://twitter.com/...",
  "discord": "https://discord.gg/...",
  "website": "https://...",
  "verification": true
}
```

---

### POST /v3/market/collection/auction/collection_statistic_list
Lista de coleções com ranking por volume.

**Request:**
```json
{
  "filter": {
    "timeType": "1d",
    "name": "node"
  },
  "start": 0,
  "limit": 20
}
```

`timeType`: `"1d"` | `"7d"` | `"30d"`

**Resposta `data`:** `{ "list": [...collection_statistic...], "total": N }`

---

### POST /v3/market/collection/auction/collection_summary
Resumo da coleção para um endereço específico (quantas o usuário tem, valor total, etc.)

**Request:**
```json
{
  "firstCollectionId": "noderunners",
  "address": "bc1p..."
}
```

**Resposta `data`:**
```json
{
  "collectionId": "noderunners",
  "address": "bc1p...",
  "count": 5,
  "totalValue": 250000,
  "floorPrice": 50000
}
```

---

### POST /v3/market/collection/auction/collection_inscriptions
**Endpoint principal para extração de traits.**
Lista de inscrições de uma coleção (paginado), com atributos.

**Request:**
```json
{
  "collectionId": "noderunners",
  "address": "bc1p...",   // opcional: filtrar por dono
  "start": 0,
  "limit": 100
}
```

**Resposta `data`:**
```json
{
  "total": 10000,
  "list": [
    {
      "auctionId": "auction_xxx",
      "inscriptionId": "abc...i0",
      "inscriptionNumber": 42000,
      "address": "bc1p...",
      "price": 50000,
      "unitPrice": 50000,
      "nftType": "collection",
      "status": "listed",
      "collectionId": "noderunners",
      "collectionItemName": "NodeRunner #42",
      "contentType": "image/png",
      "contentBody": "",
      "attributes": [
        { "trait_type": "Background", "value": "Blue Sky" },
        { "trait_type": "Body", "value": "Gold" },
        { "trait_type": "Eyes", "value": "Laser" }
      ]
    }
  ]
}
```

> **Campos chave:** `attributes[]` (traits), `price` (0 se não listado), `status`.

---

### POST /v3/market/collection/auction/inscription_info
Info completa de uma inscrição no contexto do marketplace.

**Request:**
```json
{ "inscriptionId": "abc...i0" }
```

**Resposta `data`:**
```json
{
  "auctionId": "auction_xxx",
  "inscriptionId": "abc...i0",
  "inscriptionNumber": 42000,
  "marketType": "collection",
  "address": "bc1p...",
  "price": 50000,
  "nftType": "collection",
  "status": "listed",
  "collectionId": "noderunners",
  "collectionItemName": "NodeRunner #42",
  "contentType": "image/png",
  "contentBody": "",
  "attributes": [
    { "trait_type": "Background", "value": "Blue Sky" }
  ]
}
```

---

### POST /v3/market/collection/auction/inscription_info_list
**Batch de inscrições — use para minimizar chamadas.**

**Request:**
```json
{
  "inscriptionIds": [
    "abc...i0",
    "def...i0",
    "ghi...i0"
  ]
}
```

**Resposta `data`:** `{ "list": [...inscription_info...] }`

Limite prático: ~100 IDs por chamada.

---

### POST /v3/market/collection/auction/list
Listings ativos com filtros avançados.

**Request:**
```json
{
  "filter": {
    "nftType": "collection",
    "collectionId": "noderunners",
    "minPrice": 10000,
    "maxPrice": 100000,
    "nftConfirm": true,
    "isEnd": false
  },
  "sort": {
    "unitPrice": 1,
    "onSaleTime": -1,
    "inscriptionNumber": 1
  },
  "start": 0,
  "limit": 100
}
```

`sort`: `1` = ASC, `-1` = DESC. Campos: `unitPrice`, `onSaleTime`, `initPrice`, `inscriptionNumber`.

**Resposta `data`:** `{ "total": N, "list": [...inscription_info + price/listing data...] }`

---

### POST /v3/market/collection/auction/actions
Histórico de atividade (vendas, listagens, cancelamentos).

**Request:**
```json
{
  "filter": {
    "nftType": "collection",
    "collectionId": "noderunners",
    "event": "Sold",
    "address": "bc1p..."
  },
  "start": 0,
  "limit": 100
}
```

`event`: `"Listed"` | `"Delisted"` | `"Sold"` | `"Cancel"`

**Resposta `data`:**
```json
{
  "total": 500,
  "list": [
    {
      "auctionId": "...",
      "inscriptionId": "...",
      "inscriptionNumber": 42000,
      "event": "Sold",
      "price": 55000,
      "from": "bc1p...",
      "to": "bc1p...",
      "timestamp": 1714000000,
      "nftConfirmNum": 6,
      "attributes": [
        { "trait_type": "Background", "value": "Blue Sky" }
      ],
      "collectionId": "noderunners",
      "collectionItemName": "NodeRunner #42"
    }
  ]
}
```

---

## MÓDULO: BRC-20

### GET /v1/indexer/address/{address}/brc20/summary
Resumo de todos os tickers BRC-20 de um endereço.

### GET /v1/indexer/brc20/{ticker}/info
Info de um ticker específico (supply, holders, etc.)

### GET /v1/indexer/address/{address}/brc20/{ticker}/info
Saldo de um endereço em um ticker específico.

---

## MÓDULO: Runes

### GET /v1/indexer/runes/info
Lista de Runes existentes.

### GET /v1/indexer/address/{address}/runes/{runeId}/balance
Saldo de um Rune em um endereço.

### GET /v1/indexer/address/{address}/runes/{runeId}/utxo
UTXOs contendo um Rune específico.

---

## MÓDULO: Sat Rarity (via campo `sat`)

O campo `sat` retornado em `/v1/indexer/inscription/info` é o número ordinal do satoshi.
Para avaliar raridade do sat, use a teoria ordinal:

| Tipo | Critério |
|------|---------|
| `mythic` | Primeiro sat do bloco genesis |
| `legendary` | Primeiro sat de cada ajuste de dificuldade de halving |
| `epic` | Primeiro sat de cada halving |
| `rare` | Primeiro sat de cada ajuste de dificuldade (2016 blocos) |
| `uncommon` | Primeiro sat de cada bloco |
| `common` | Todos os outros |

Calcule via: `ordinal-theory` npm package ou pela lógica de divisão do número do sat pelos pontos de controle da chain.
