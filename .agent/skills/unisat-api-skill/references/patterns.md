# Padrões de Otimização — UniSat API

## Princípio central: "Buscar largo uma vez, processar localmente"

Em vez de fazer N chamadas individuais para N inscrições, prefira:
1. Buscar a coleção inteira de uma vez (paginado)
2. Processar/filtrar/ranquear localmente
3. Só chamar endpoints individuais quando precisar de dados não disponíveis em batch

---

## 1. Cliente HTTP Robusto

```python
import time
import requests
from typing import Any

class UniSatClient:
    def __init__(self, api_key: str, network: str = "mainnet"):
        hosts = {
            "mainnet":  "https://open-api.unisat.io",
            "testnet":  "https://open-api-testnet.unisat.io",
            "fractal":  "https://open-api-fractal.unisat.io",
        }
        self.base_url = hosts[network]
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        })
        self._req_timestamps: list[float] = []
        self.rate_limit = 4  # req/s seguro para plano free (limite real = 5)
    
    def _throttle(self):
        """Rate limiter simples: máximo N req/s."""
        now = time.time()
        self._req_timestamps = [t for t in self._req_timestamps if now - t < 1.0]
        if len(self._req_timestamps) >= self.rate_limit:
            sleep_time = 1.0 - (now - self._req_timestamps[0])
            if sleep_time > 0:
                time.sleep(sleep_time)
        self._req_timestamps.append(time.time())
    
    def _handle_response(self, resp: requests.Response) -> Any:
        resp.raise_for_status()
        data = resp.json()
        if data.get("code", -1) != 0:
            raise ValueError(f"UniSat API error: {data.get('msg', 'unknown')}")
        return data["data"]
    
    def get(self, path: str, params: dict = None, retries: int = 3) -> Any:
        for attempt in range(retries):
            try:
                self._throttle()
                resp = self.session.get(f"{self.base_url}{path}", params=params)
                return self._handle_response(resp)
            except requests.HTTPError as e:
                if e.response.status_code == 429 and attempt < retries - 1:
                    time.sleep(2 ** attempt)  # backoff: 1s, 2s, 4s
                    continue
                raise
    
    def post(self, path: str, body: dict, retries: int = 3) -> Any:
        for attempt in range(retries):
            try:
                self._throttle()
                resp = self.session.post(f"{self.base_url}{path}", json=body)
                return self._handle_response(resp)
            except requests.HTTPError as e:
                if e.response.status_code == 429 and attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise
    
    def paginate_post(self, path: str, body: dict, list_key: str = "list",
                      limit: int = 100, max_items: int = None) -> list:
        """Pagina automaticamente um endpoint POST."""
        results = []
        start = 0
        while True:
            data = self.post(path, {**body, "start": start, "limit": limit})
            items = data.get(list_key, [])
            results.extend(items)
            total = data.get("total", 0)
            start += len(items)
            if max_items and len(results) >= max_items:
                return results[:max_items]
            if start >= total or not items:
                break
        return results
    
    def paginate_get(self, path: str, params: dict = None,
                     limit: int = 100) -> list:
        """Pagina automaticamente um endpoint GET com cursor."""
        results = []
        cursor = 0
        params = params or {}
        while True:
            data = self.get(path, {**params, "cursor": cursor, "size": limit})
            items = data.get("list", [])
            results.extend(items)
            total = data.get("total", 0)
            cursor += len(items)
            if cursor >= total or not items:
                break
        return results
```

---

## 2. Batch de Inscrições Individuais

Quando você tem uma lista de IDs e precisa de dados individuais:

```python
def batch_inscription_info(client: UniSatClient, inscription_ids: list[str],
                            batch_size: int = 100) -> dict[str, dict]:
    """
    Busca info de múltiplas inscrições em batches.
    Usa inscription_info_list para minimizar chamadas.
    Retorna dict {inscriptionId -> data}.
    """
    results = {}
    for i in range(0, len(inscription_ids), batch_size):
        batch = inscription_ids[i:i + batch_size]
        data = client.post(
            "/v3/market/collection/auction/inscription_info_list",
            {"inscriptionIds": batch}
        )
        for item in data.get("list", []):
            results[item["inscriptionId"]] = item
    return results
```

---

## 3. Paralelismo Controlado (planos pagos)

Para planos Specialist+ com rate limit mais alto:

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def parallel_inscription_details(client: UniSatClient,
                                  inscription_ids: list[str],
                                  max_workers: int = 5) -> dict[str, dict]:
    """
    Busca dados individuais em paralelo.
    Atenção: use apenas em planos com rate limit > 20 req/s.
    """
    results = {}
    
    def fetch_one(iid: str):
        return iid, client.get(f"/v1/indexer/inscription/info/{iid}")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_one, iid): iid for iid in inscription_ids}
        for future in as_completed(futures):
            try:
                iid, data = future.result()
                results[iid] = data
            except Exception as e:
                print(f"Erro em {futures[future]}: {e}")
    
    return results
```

---

## 4. Decisão: qual endpoint usar?

```
OBJETIVO                                    → ENDPOINT
─────────────────────────────────────────────────────────────────────────────
Dados de 1 inscrição específica             → GET /v1/indexer/inscription/info/{id}
Dados de 2-100 inscrições específicas       → POST inscription_info_list (batch)
Dados de 100+ inscrições de uma coleção    → POST collection_inscriptions (paginate)
Todos os itens da coleção + traits          → POST collection_inscriptions (paginate)
Stats gerais da coleção                     → POST collection_statistic
Listings ativos com filtro de preço        → POST /v3/market/collection/auction/list
Histórico de vendas                         → POST actions (event="Sold")
Inscrições de um endereço                  → GET /v1/indexer/address/{addr}/inscription-data
Saldo de um endereço                        → GET /v1/indexer/address/{addr}/balance
```

---

## 5. Cache em Disco

```python
import json, hashlib
from pathlib import Path
from datetime import datetime, timedelta

class DiskCache:
    def __init__(self, cache_dir: str = ".unisat_cache"):
        self.dir = Path(cache_dir)
        self.dir.mkdir(exist_ok=True)
    
    def _key(self, *args) -> str:
        return hashlib.md5(json.dumps(args, sort_keys=True).encode()).hexdigest()
    
    def get(self, *args, max_age_hours: float = 24) -> Any | None:
        path = self.dir / f"{self._key(*args)}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text())
        age = datetime.now() - datetime.fromisoformat(data["cached_at"])
        if age > timedelta(hours=max_age_hours):
            return None
        return data["value"]
    
    def set(self, value: Any, *args):
        path = self.dir / f"{self._key(*args)}.json"
        path.write_text(json.dumps({
            "cached_at": datetime.now().isoformat(),
            "value": value
        }))


# Uso com o cliente:
cache = DiskCache()
client = UniSatClient(api_key=API_KEY)

def get_collection_items_cached(collection_id: str) -> list:
    cached = cache.get("collection_items", collection_id, max_age_hours=12)
    if cached:
        return cached
    items = client.paginate_post(
        "/v3/market/collection/auction/collection_inscriptions",
        body={"collectionId": collection_id},
    )
    cache.set(items, "collection_items", collection_id)
    return items
```

---

## 6. Quando NÃO usar cache

- Preços de listings: mudam a cada minuto → sem cache ou TTL < 5 min
- `actions` (vendas recentes): sempre buscar fresh
- Balanços de endereço: sem cache ou TTL < 10 min

---

## 7. Fluxo Completo Recomendado

```
1. [1 call]  collection_statistic → confirmar supply, floor, verificação
2. [N calls] collection_inscriptions (paginado) → todos os itens + traits
3. [local]   compute_collection_rarity() → rank sem chamadas adicionais
4. [1 call]  collection/auction/list → listings atuais com preços
5. [local]   join por inscriptionId → enriquecer itens rankeados com preço atual
6. [cache]   salvar resultado com TTL adequado por tipo de dado
```

Resultado: análise completa de uma coleção de 10.000 itens com ~102 chamadas à API
(100 páginas de collection_inscriptions + 1 statistic + 1 listings).
