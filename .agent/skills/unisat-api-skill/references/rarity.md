# Rarity Score — Algoritmos e Implementação

## Contexto

A UniSat não entrega rarity rank pré-computado. O score deve ser calculado localmente a partir
dos traits retornados por `collection_inscriptions`. Esta referência cobre:
1. Algoritmo de raridade estatística (padrão da indústria NFT)
2. Implementação completa em Python
3. Variações (com peso por trait type, com missing trait penalizado)
4. Integração com sat rarity

---

## 1. Algoritmo Base: Rarity Score Estatístico

O mais usado em coleções NFT (adaptado do trabalho original de raritytools.io):

```
Para cada inscrição I:
  rarityScore(I) = Σ [ 1 / P(trait_type = value) ]

Onde:
  P(trait_type = value) = count(items com esse valor) / total_items
  = total_items / count(items com esse valor)          ← simplificado
```

Quanto mais raro um trait (baixa frequência), mais ele contribui para o score.
Items com mais traits raros acumulam score maior → rank mais alto (mais raro).

---

## 2. Implementação Python Completa

```python
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional
import json

@dataclass
class InscriptionRarity:
    inscription_id: str
    inscription_number: int
    attributes: list[dict]
    rarity_score: float = 0.0
    rarity_rank: int = 0
    trait_scores: dict = field(default_factory=dict)
    sat_rarity: Optional[str] = None

def compute_collection_rarity(
    inscriptions: list[dict],
    penalize_missing_traits: bool = True
) -> list[InscriptionRarity]:
    """
    Calcula rarity rank para toda uma coleção.
    
    Args:
        inscriptions: lista de items retornados por collection_inscriptions
        penalize_missing_traits: se True, itens sem um trait recebem penalidade
                                 (tratado como trait_type: value = "None")
    
    Returns:
        lista de InscriptionRarity ordenada por rank (1 = mais raro)
    """
    n = len(inscriptions)
    if n == 0:
        return []
    
    # 1. Descobrir todos os trait_types existentes na coleção
    all_trait_types = set()
    for item in inscriptions:
        for attr in item.get("attributes", []):
            all_trait_types.add(attr["trait_type"])
    
    # 2. Contar frequência de cada (trait_type, value)
    freq: dict[tuple, int] = Counter()
    
    for item in inscriptions:
        seen_types = set()
        for attr in item.get("attributes", []):
            key = (attr["trait_type"], str(attr["value"]))
            freq[key] += 1
            seen_types.add(attr["trait_type"])
        
        if penalize_missing_traits:
            # traits ausentes = value "None" — conta como trait raro
            for trait_type in all_trait_types:
                if trait_type not in seen_types:
                    freq[(trait_type, "None")] += 1
    
    # 3. Calcular score por inscrição
    results = []
    for item in inscriptions:
        seen_types = set()
        trait_scores = {}
        total_score = 0.0
        
        for attr in item.get("attributes", []):
            key = (attr["trait_type"], str(attr["value"]))
            score = n / freq[key]  # 1 / frequência relativa
            trait_scores[f"{attr['trait_type']}: {attr['value']}"] = round(score, 4)
            total_score += score
            seen_types.add(attr["trait_type"])
        
        if penalize_missing_traits:
            for trait_type in all_trait_types:
                if trait_type not in seen_types:
                    key = (trait_type, "None")
                    score = n / freq[key]
                    trait_scores[f"{trait_type}: None"] = round(score, 4)
                    total_score += score
        
        results.append(InscriptionRarity(
            inscription_id=item.get("inscriptionId", ""),
            inscription_number=item.get("inscriptionNumber", 0),
            attributes=item.get("attributes", []),
            rarity_score=round(total_score, 4),
            trait_scores=trait_scores,
        ))
    
    # 4. Ordenar e atribuir ranks
    results.sort(key=lambda x: x.rarity_score, reverse=True)
    for rank, item in enumerate(results, 1):
        item.rarity_rank = rank
    
    return results


# --- Exemplo de uso ---

def load_collection_from_unisat(collection_id: str, api_key: str) -> list[dict]:
    """Busca todos os itens de uma coleção via UniSat API."""
    import requests, time
    
    BASE = "https://open-api.unisat.io"
    HEADERS = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    
    all_items = []
    start = 0
    limit = 100
    
    while True:
        resp = requests.post(
            f"{BASE}/v3/market/collection/auction/collection_inscriptions",
            json={"collectionId": collection_id, "start": start, "limit": limit},
            headers=HEADERS
        )
        resp.raise_for_status()
        data = resp.json()
        assert data["code"] == 0, f"Erro UniSat: {data['msg']}"
        
        items = data["data"]["list"]
        all_items.extend(items)
        
        total = data["data"]["total"]
        start += len(items)
        
        print(f"  Carregados {start}/{total}...")
        
        if start >= total or not items:
            break
        
        time.sleep(0.25)  # respeitar rate limit free tier (5 req/s)
    
    return all_items


if __name__ == "__main__":
    import os
    
    API_KEY = os.environ["UNISAT_KEY"]
    COLLECTION_ID = "noderunners"
    
    print(f"Buscando itens de '{COLLECTION_ID}'...")
    items = load_collection_from_unisat(COLLECTION_ID, API_KEY)
    print(f"Total carregado: {len(items)} itens")
    
    print("Calculando rarity...")
    ranked = compute_collection_rarity(items, penalize_missing_traits=True)
    
    print("\nTop 10 mais raros:")
    for item in ranked[:10]:
        print(f"  Rank #{item.rarity_rank:4d} | Score: {item.rarity_score:8.2f} | "
              f"#{item.inscription_number} | {item.inscription_id[:20]}...")
        for trait, score in sorted(item.trait_scores.items(), key=lambda x: -x[1])[:3]:
            print(f"    {trait}: {score:.2f}")
    
    # Exportar CSV
    import csv
    with open("rarity_output.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "score", "inscriptionNumber", "inscriptionId"])
        for item in ranked:
            w.writerow([item.rarity_rank, item.rarity_score,
                        item.inscription_number, item.inscription_id])
    print("\nExportado para rarity_output.csv")
```

---

## 3. Variação: Com Peso por Categoria de Trait

Quando certas categorias de trait (ex: "Legendary Item") devem ter mais peso:

```python
TRAIT_WEIGHTS = {
    "Legendary Item": 3.0,
    "Background": 0.5,  # backgrounds são menos diferenciadores
    # demais ficam em 1.0 por padrão
}

def compute_weighted_rarity(inscriptions, weights=TRAIT_WEIGHTS):
    n = len(inscriptions)
    freq = Counter()
    for item in inscriptions:
        for attr in item.get("attributes", []):
            freq[(attr["trait_type"], str(attr["value"]))] += 1
    
    for item in inscriptions:
        score = 0.0
        for attr in item.get("attributes", []):
            key = (attr["trait_type"], str(attr["value"]))
            weight = weights.get(attr["trait_type"], 1.0)
            score += weight * (n / freq[key])
        item["rarityScore"] = round(score, 4)
    
    inscriptions.sort(key=lambda x: x["rarityScore"], reverse=True)
    for i, item in enumerate(inscriptions, 1):
        item["rarityRank"] = i
    return inscriptions
```

---

## 4. Sat Rarity (via campo `sat`)

Para avaliar raridade do satoshi da inscrição:

```python
# Pontos de controle da Bitcoin mainnet (simplificado)
HALVING_EPOCHS = [
    0,           # genesis
    1050000,     # halving 1
    2100000,     # halving 2
    3150000,     # halving 3
    4200000,     # halving 4 (2024)
]

DIFF_ADJUSTMENT_PERIOD = 2016 * 100  # ~2016 blocos * 100 sats base simplificado

def sat_rarity(sat_number: int) -> str:
    """
    Classificação básica de raridade de sat.
    Para produção, use a biblioteca 'ordinals' ou 'ord' CLI.
    """
    if sat_number == 0:
        return "mythic"
    
    # Simplificação — para implementação precisa use: 
    # https://github.com/casey/ord (Rust) ou ordinals-api
    sats_per_block = 50 * 100_000_000  # era initial
    
    # Epic: primeiro sat de cada halving epoch
    for epoch_start in HALVING_EPOCHS[1:]:
        if sat_number == epoch_start * sats_per_block:
            return "epic"
    
    # Rare: primeiro sat de cada ajuste de dificuldade (~2016 blocos)
    block_number = sat_number // sats_per_block
    if block_number % 2016 == 0 and sat_number % sats_per_block == 0:
        return "rare"
    
    # Uncommon: primeiro sat de cada bloco
    if sat_number % sats_per_block == 0:
        return "uncommon"
    
    return "common"


# Adicionar sat rarity ao pipeline:
def enrich_with_sat_rarity(ranked_items: list, inscription_details: dict) -> list:
    """
    inscription_details: dict {inscriptionId -> data de /v1/indexer/inscription/info}
    """
    for item in ranked_items:
        detail = inscription_details.get(item.inscription_id, {})
        sat = detail.get("sat")
        if sat:
            item.sat_rarity = sat_rarity(sat)
    return ranked_items
```

---

## 5. Filtros por Trait (client-side)

```python
def filter_by_traits(
    ranked: list[InscriptionRarity],
    filters: dict[str, list[str]]
) -> list[InscriptionRarity]:
    """
    Filtra itens por combinação de traits.
    
    filters = {
        "Background": ["Blue Sky", "Gold"],
        "Eyes": ["Laser"]
    }
    Retorna itens que têm qualquer dos valores em CADA categoria especificada.
    """
    def matches(item):
        item_traits = {a["trait_type"]: str(a["value"]) for a in item.attributes}
        for trait_type, allowed_values in filters.items():
            if item_traits.get(trait_type) not in allowed_values:
                return False
        return True
    
    return [item for item in ranked if matches(item)]


# Uso:
results = filter_by_traits(ranked, {
    "Background": ["Cosmic", "Golden"],
    "Rarity": ["Legendary"]
})
print(f"Encontrados {len(results)} itens com esses traits")
```

---

## 6. Cache Estratégico

O rarity rank de uma coleção só muda se:
- Novos itens forem mintados (supply aumenta)
- Novos traits forem revelados (reveal event)

Estratégia recomendada:

```python
import json
from pathlib import Path
from datetime import datetime

def cached_collection_data(collection_id: str, max_age_hours: int = 24) -> list | None:
    cache_file = Path(f".cache/{collection_id}.json")
    if cache_file.exists():
        data = json.loads(cache_file.read_text())
        age_hours = (datetime.now().timestamp() - data["cached_at"]) / 3600
        if age_hours < max_age_hours:
            return data["items"]
    return None

def save_to_cache(collection_id: str, items: list):
    cache_dir = Path(".cache")
    cache_dir.mkdir(exist_ok=True)
    (cache_dir / f"{collection_id}.json").write_text(json.dumps({
        "cached_at": datetime.now().timestamp(),
        "items": items
    }))
```
