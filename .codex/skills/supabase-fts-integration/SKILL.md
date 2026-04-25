---
name: supabase-fts-integration
description: Supabase Full-Text Search integration with MCP + ReAct Agent. Critical pitfalls, schema setup, adapter patterns, and progressive fallback. Learned from production debugging.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Supabase FTS + MCP + Agent Integration

> **Post-mortem skill** — Every section below documents a real production failure. Follow this to avoid days of debugging.

---

## 🗺️ Content Map

| File | Description | When to Read |
|------|-------------|--------------|
| `SKILL.md` | This file — overview, pitfalls, checklist | Always |
| `schema-setup.md` | PostgreSQL FTS schema, tsvector, GIN index | Setting up database |
| `adapter-pattern.md` | SupabasePriceAdapter implementation with progressive fallback | Building the adapter |
| `mcp-registration.md` | MCP tool lifecycle — `__init__` vs `initialize()` | Wiring MCP to agents |

---

## 🚨 Critical Pitfalls (Production Failures)

These are **real bugs** that caused the system to silently fail in production. Each one took hours to identify.

### Pitfall 1: `initialize()` Never Called → Tools Not Registered

| Aspect | Detail |
|--------|--------|
| **Symptom** | Agent logs `Executing search_price` but no DB query follows. LLM says "ferramenta instável" |
| **Root Cause** | MCP tools were registered inside `async initialize()`, but the Orchestrator's lazy property only called `__init__()` |
| **Impact** | `list_tools()` returned `[]` → NO tools registered in agent's SkillRegistry → tool calls silently fail |
| **Fix** | Move `register_tool()` calls from `initialize()` to `__init__()` or a sync `_register_tools()` called from `__init__` |

```python
# ❌ WRONG — tools only available after await initialize()
class MyMCP(BaseMCP):
    def __init__(self):
        super().__init__(name="my_mcp", description="...")
    
    async def initialize(self):  # Called by who? Nobody!
        self.register_tool(MCPTool(name="search", ...))

# ✅ CORRECT — tools available immediately
class MyMCP(BaseMCP):
    def __init__(self):
        super().__init__(name="my_mcp", description="...")
        self._register_tools()  # Sync, called in __init__
        
    def _register_tools(self):
        self.register_tool(MCPTool(name="search", ...))
    
    async def initialize(self):  # Optional: pre-warm connections
        for adapter in self.adapters:
            await adapter.initialize()
```

> **Diagnostic:** Check if `list_tools()` returns an empty list BEFORE any `initialize()` call. If so, this is the bug.

---

### Pitfall 2: Missing `execute()` on Supabase Query

| Aspect | Detail |
|--------|--------|
| **Symptom** | `UnboundLocalError` or no results from adapter |
| **Root Cause** | Query builder was constructed but `.execute()` was never called |
| **Fix** | Always chain `.execute()` at the end of every Supabase query |

```python
# ❌ WRONG — builds query but never runs it
db_query = self.client.table("prices").select("*").eq("region", "MG")
# response is undefined here!

# ✅ CORRECT
response = self.client.table("prices").select("*").eq("region", "MG").execute()
```

---

### Pitfall 3: `text_search()` Config Parameter

| Aspect | Detail |
|--------|--------|
| **Symptom** | `TypeError` — unexpected keyword argument `config` |
| **Root Cause** | `postgrest-py` SDK requires `config` inside an `options` dict |
| **Fix** | Use `options={"config": "portuguese"}` |

```python
# ❌ WRONG — raises TypeError
db_query.text_search("fts_column", query, config="portuguese")

# ✅ CORRECT
db_query.text_search("fts_column", query, options={"config": "portuguese"})
```

---

### Pitfall 4: FTS AND Query Too Strict

| Aspect | Detail |
|--------|--------|
| **Symptom** | Queries like `revestimento & ceramico & parede & interna` return 0 results |
| **Root Cause** | PostgreSQL FTS `&` (AND) requires ALL words to match in a single row. SINAPI descriptions rarely contain ALL search terms |
| **Fix** | Progressive fallback — try all words, then drop trailing words until results found |

```python
# ❌ WRONG — too strict, 0 results for most multi-word queries
fts_query = " & ".join(all_words)  # "revestimento & ceramico & parede & interna"
db_query.text_search("fts_description", fts_query, ...)

# ✅ CORRECT — progressive fallback
attempt_words = list(words)
while len(attempt_words) >= 1:
    fts_query = " & ".join(attempt_words)
    response = build_query().text_search(..., fts_query, ...).execute()
    if response.data:
        break
    attempt_words.pop()  # Drop least relevant word
```

---

### Pitfall 5: Silent Error Swallowing in Skill.execute()

| Aspect | Detail |
|--------|--------|
| **Symptom** | Tool "executes" but observation is an error string that the LLM interprets as failure |
| **Root Cause** | `Skill.execute()` catches ALL exceptions and returns `"Error executing skill: ..."` as a string, not raising |
| **Impact** | No stack trace in logs. LLM sees the error message and says "tool instável" |
| **Mitigation** | Add explicit logging inside handlers. Watch for observations that start with `"Error"` |

---

### Pitfall 6: Supabase SDK Builder Order Matters

| Aspect | Detail |
|--------|--------|
| **Symptom** | `AttributeError: 'SyncQueryRequestBuilder' object has no attribute 'limit'` |
| **Root Cause** | `text_search()` returns a different builder type that doesn't have `.limit()` |
| **Fix** | Call `.limit()` BEFORE `.text_search()` |

```python
# ❌ WRONG — limit() after text_search() raises AttributeError
db_query.text_search("fts", query, ...).limit(20)

# ✅ CORRECT — limit() before text_search()
db_query.limit(20).text_search("fts", query, ...)
```

---

## 🏗️ Architecture Overview

```
┌──────────────────┐    ┌─────────────────┐    ┌───────────────────────┐
│   Orchestrator   │───▶│   BudgetAgent   │───▶│   SkillRegistry       │
│ (lazy property)  │    │  (BaseAgent)    │    │  .execute("search_..") │
└──────────────────┘    └─────────────────┘    └──────────┬────────────┘
                                                          │
                        ┌─────────────────┐               │
                        │    PriceMCP      │◀──────────────┘
                        │  .__init__() ←── tools registered HERE
                        │  .call_tool()    │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │  Supabase       │
                        │  PriceAdapter   │
                        │  .search_items()│
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │  PostgreSQL     │
                        │  FTS + GIN      │
                        └─────────────────┘
```

### Data Flow (Tool Call)

1. LLM outputs `Action: search_price` + `Action Input: {"queries": [...], "region": "MG", "ref_date": "01/2026"}`
2. `ReasoningChain.process_step()` parses the text
3. `SkillRegistry.execute("search_price", params)` → `Skill.execute(**params)`
4. `price_handler(**kwargs)` → `PriceMCP.call_tool("search_price", kwargs)`
5. `search_price_handler(args)` → iterates adapters → `adapter.search_items(query, region, ref_date)`
6. Adapter builds Supabase query with FTS → `.execute()` → returns `PriceItem` list
7. Results fed back as `Observation` message → next LLM iteration uses the data

---

## ✅ Implementation Checklist

### Database Setup
- [ ] Created `fts_description` column (`tsvector`) on `prices` table
- [ ] Populated `fts_description`: `UPDATE prices SET fts_description = to_tsvector('portuguese', description);`
- [ ] Created GIN index: `CREATE INDEX idx_fts_description ON prices USING GIN(fts_description);`
- [ ] Verified with: `SELECT * FROM prices WHERE fts_description @@ to_tsquery('portuguese', 'cimento');`

### Adapter
- [ ] `search_items()` calls `.execute()` on every query
- [ ] `text_search()` uses `options={"config": "portuguese"}`
- [ ] `.limit()` comes BEFORE `.text_search()` in the chain
- [ ] Progressive fallback: all words → N-1 words → ... → 1 word → ILIKE
- [ ] `clean_word()` removes accents and trailing 's' for pseudo-stemming

### MCP
- [ ] Tools registered in `__init__()`, NOT in `async initialize()`
- [ ] Each tool has `handler` pointing to an `async` method
- [ ] `input_schema` includes clear descriptions for LLM guidance
- [ ] `initialize()` only pre-warms connections (optional)

### Agent Integration
- [ ] `register_mcp_tools()` wraps MCP tools as `Skill` objects in the SkillRegistry
- [ ] System prompt includes search tips: "Use termos SIMPLES, CURTOS e no SINGULAR"
- [ ] `Skill.execute()` error handling doesn't swallow critical errors silently

### Testing
- [ ] Unit test: `PriceMCP()` → verify `list_tools()` has all tools (NO `initialize()`)
- [ ] Integration test: `call_tool("search_price", {...})` → verify non-empty results
- [ ] E2E test: simulate full agent flow with real Supabase queries

---

## 🔍 Diagnostic Commands

Quick checks when things aren't working:

```python
# 1. Are tools registered?
mcp = PriceMCP()
print(mcp.list_tools())  # Should NOT be empty

# 2. Does the adapter actually return data?
adapter = SupabasePriceAdapter(source_name="SINAPI")
results = await adapter.search_items("cimento", region="MG", ref_date="01/2026")
print(len(results))  # Should be > 0

# 3. Does FTS work in raw SQL?
# In Supabase SQL Editor:
SELECT * FROM prices 
WHERE fts_description @@ to_tsquery('portuguese', 'cimento')
  AND region = 'MG' AND ref_date = '01/2026'
LIMIT 5;

# 4. Is the tool in the agent's SkillRegistry?
print(agent.skill_registry.get_skill("search_price"))  # Should NOT be None
```

---

## 🔑 LLM System Prompt Tips

The LLM needs guidance on how to formulate search queries:

```
DICA DE BUSCA: O banco de dados exige palavras-chave exatas. 
Use termos SIMPLES, CURTOS e no SINGULAR 
(ex: 'revestimento ceramico' em vez de 'revestimento cerâmico parede interna 20x20'). 
Evite frases longas nas queries.
```

**Why this matters:** Even with progressive fallback, simpler queries produce better results. The LLM will often retry with shorter terms if the first attempt fails, but guiding it upfront saves an LLM call (saves API quota and ~15s of latency).

---

> **Remember:** The most dangerous bugs in this stack are SILENT. The `Skill.execute()` try/except, the empty `list_tools()`, the `text_search` TypeError — all fail without crashing. Add explicit logging at every layer.
