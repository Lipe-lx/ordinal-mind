# Adapter Pattern: Progressive FTS Fallback

> The adapter is the critical bridge between your MCP and Supabase. Get it wrong and you get silent failures.

---

## Reference Implementation

```python
from typing import List, Optional
from supabase import Client

class SupabasePriceAdapter:
    def __init__(self, source_name: str = "SINAPI"):
        self.source_name = source_name
        self._client: Optional[Client] = None

    @property
    def client(self) -> Client:
        if not self._client:
            self._client = get_supabase_client()  # Lazy init
        return self._client

    async def search_items(
        self, query: str, limit: int = 20,
        region: Optional[str] = None, ref_date: Optional[str] = None
    ) -> List[PriceItem]:
        import unicodedata

        def clean_word(w):
            w = "".join(c for c in unicodedata.normalize("NFD", w)
                        if unicodedata.category(c) != "Mn")
            return w[:-1] if w.endswith("s") and len(w) > 3 else w

        words = [clean_word(w) for w in query.split() if len(w) > 2]

        def _build_base_query():
            q = self.client.table("prices").select("*")
            if region:
                q = q.eq("region", region)
            if ref_date:
                q = q.eq("ref_date", ref_date)
            return q.limit(limit)  # ⚠️ limit() BEFORE text_search()

        response = None

        if words:
            # PROGRESSIVE FTS FALLBACK
            attempt_words = list(words)
            while len(attempt_words) >= 1:
                fts_query = " & ".join(attempt_words)
                db_query = _build_base_query()
                db_query = db_query.text_search(
                    "fts_description", fts_query,
                    options={"config": "portuguese"}  # ⚠️ Must be in options dict
                )
                response = db_query.execute()  # ⚠️ Don't forget execute()!
                if response.data:
                    break
                attempt_words.pop()

            # Final fallback: ILIKE
            if not response or not response.data:
                db_query = _build_base_query()
                db_query = db_query.ilike("description", f"%{words[0]}%")
                response = db_query.execute()
        else:
            db_query = _build_base_query()
            db_query = db_query.ilike("description", f"%{query}%")
            response = db_query.execute()

        items = []
        for data in response.data:
            if self.source_name and data.get("source") != self.source_name:
                continue
            items.append(self._map_to_price_item(data))
        return items
```

---

## Why Progressive Fallback?

The LLM generates natural language queries like `"revestimento cerâmico parede interna"`. 
PostgreSQL FTS with `&` (AND) requires ALL words to match in a SINGLE row.

| Query | Results |
|-------|---------|
| `revestimento & ceramico & parede & interna` | 0 ❌ |
| `revestimento & ceramico & parede` | 2 ✅ |
| `revestimento & ceramico` | 3 ✅ |
| `piso & ceramico & interno` | 0 ❌ |
| `piso & ceramico` | 3 ✅ |

The fallback drops the **last word** first because it's usually the least important qualifier (e.g., `interna`, `interno`).

---

## Builder Chain Order

The Supabase Python SDK has strict ordering requirements:

```
.select("*") → .eq() → .limit() → .text_search() → .execute()
                                     ↑ Returns a different builder type
                                       (.limit() won't work after this)
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do |
|----------|-------|
| Use `|` (OR) for everything | Use `&` (AND) with progressive fallback |
| Skip `execute()` | Always call `.execute()` |
| Put `config` as kwarg | Use `options={"config": "portuguese"}` |
| Put `limit()` after `text_search()` | Put `limit()` before `text_search()` |
| Return raw dicts | Map to typed `PriceItem` models |
