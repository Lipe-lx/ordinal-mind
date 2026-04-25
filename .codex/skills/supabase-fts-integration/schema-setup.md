# PostgreSQL FTS Schema Setup for Supabase

> Step-by-step guide to enable Full-Text Search on your Supabase table.

---

## 1. Add `tsvector` Column

```sql
ALTER TABLE prices ADD COLUMN fts_description tsvector;
```

## 2. Populate with Portuguese Dictionary

```sql
UPDATE prices 
SET fts_description = to_tsvector('portuguese', COALESCE(description, ''));
```

> **Why `'portuguese'`?** Without it, PostgreSQL uses the `simple` dictionary which doesn't stem or handle stop words. Portuguese stemming converts "revestimentos" → "revestiment", "cerâmica" → "cerâm", enabling fuzzy matching.

## 3. Create GIN Index

```sql
CREATE INDEX idx_fts_description ON prices USING GIN(fts_description);
```

> **Performance:** Without GIN index, FTS does a sequential scan. With GIN, it's an index scan — **100x faster** on large tables (600k+ rows).

## 4. Auto-Update Trigger (Optional)

```sql
CREATE OR REPLACE FUNCTION update_fts_description()
RETURNS trigger AS $$
BEGIN
    NEW.fts_description := to_tsvector('portuguese', COALESCE(NEW.description, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fts_description
    BEFORE INSERT OR UPDATE OF description ON prices
    FOR EACH ROW
    EXECUTE FUNCTION update_fts_description();
```

## 5. Verify

```sql
-- Should return results
SELECT code, description 
FROM prices 
WHERE fts_description @@ to_tsquery('portuguese', 'cimento')
LIMIT 5;

-- Check tsvector content
SELECT description, fts_description 
FROM prices 
WHERE code = '00536'
LIMIT 1;
```

---

## Accent Handling

PostgreSQL's `portuguese` dictionary handles accents via stemming, but the search query should also be normalized. The adapter's `clean_word()` function handles this:

```python
import unicodedata

def clean_word(w):
    # Remove accents: "cerâmica" → "ceramica"
    w = "".join(c for c in unicodedata.normalize("NFD", w) 
                if unicodedata.category(c) != "Mn")
    # Pseudo-stemming: "revestimentos" → "revestimento"
    return w[:-1] if w.endswith("s") and len(w) > 3 else w
```

---

## Mandatory Filters

SINAPI data requires these filters for meaningful results:

| Filter | Column | Example | Required? |
|--------|--------|---------|-----------|
| **Region** | `region` | `MG`, `SP`, `RJ` | ✅ Yes |
| **Ref Date** | `ref_date` | `01/2026` | ✅ Yes |
| **Source** | `source` | `SINAPI`, `SICRO` | Adapter-level |
