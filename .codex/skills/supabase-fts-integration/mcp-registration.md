# MCP Tool Lifecycle: Registration vs Initialization

> The #1 cause of "tools not working" — understanding when tools become available.

---

## The Problem

```
Orchestrator                Agent                    MCP
    │                        │                        │
    ├─ PriceMCP()  ─────────►│                        │
    │  (lazy property)       │                        │
    │                        │                        │
    ├─ register_mcp_tools() ─┤                        │
    │                        ├─ list_tools() ─────────►│ ← Returns []
    │                        │ Nothing to register!    │   if tools are in
    │                        │                         │   initialize() only
    │                        │                         │
    │   LLM outputs          │                         │
    │   "Action: search_..."─┤                         │
    │                        ├─ skill_registry.get() ──►│ ← None!
    │                        │  Tool not found!        │
```

---

## The Solution

Tools registration MUST happen in `__init__()`, not in `async initialize()`:

```python
class PriceMCP(BaseMCP):
    def __init__(self, adapters=None):
        super().__init__(name="price_mcp", description="...")
        self.adapters = adapters or [
            SupabasePriceAdapter(source_name="SINAPI"),
            SupabasePriceAdapter(source_name="SICRO"),
        ]
        self._register_tools()  # ✅ Sync, immediate

    def _register_tools(self):
        """Tools available the moment PriceMCP() is created."""
        self.register_tool(MCPTool(
            name="search_price",
            description="Search for prices of materials or services.",
            input_schema={...},
            handler=self.search_price_handler
        ))
        # ... more tools

    async def initialize(self):
        """Optional: pre-warm adapter connections."""
        for adapter in self.adapters:
            await adapter.initialize()
```

---

## Registration Flow (Correct)

```
Orchestrator                Agent                    MCP
    │                        │                        │
    ├─ PriceMCP()  ──────────────────────────────────►│
    │  __init__() → _register_tools()                 │ ← 4 tools registered
    │                        │                        │
    ├─ register_mcp_tools() ─┤                        │
    │                        ├─ list_tools() ─────────►│ ← Returns [search_price, ...]
    │                        ├─ Skill("search_price")  │
    │                        ├─ registry.register()    │
    │                        │                         │
    │   LLM: "search_price"──┤                         │
    │                        ├─ registry.execute() ────►│
    │                        │                ┌────────►│
    │                        │                │ call_tool("search_price", args)
    │                        │                │         ├──► Supabase query
    │                        │◄───────────────┘         │◄── Results
    │                        │  Observation with data   │
```

---

## Agent's `register_mcp_tools()` Bridge

The agent wraps MCP tools as `Skill` objects:

```python
def register_mcp_tools(self, price_mcp: PriceMCP, ...):
    for mcp_tool in price_mcp.list_tools():  # Must return tools!
        async def handler(tool_name=mcp_tool.name, **kwargs):
            return await price_mcp.call_tool(tool_name, kwargs)
        
        self.skill_registry.register(Skill(
            name=mcp_tool.name,
            description=mcp_tool.description,
            parameters=mcp_tool.input_schema,
            func=handler
        ))
```

> ⚠️ **Default argument trick:** `tool_name=mcp_tool.name` in the closure is critical. Without it, all handlers would reference the last `mcp_tool` in the loop (Python closure gotcha).

---

## Verification Test

```python
def test_tools_registered_without_initialize():
    """Tools must be available immediately, without calling initialize()."""
    mcp = PriceMCP()
    tools = [t.name for t in mcp.list_tools()]
    
    assert "search_price" in tools
    assert "get_item_price" in tools
    assert "calculate_composition" in tools
    assert len(tools) >= 3
```

---

## Common Mistakes

| Mistake | Consequence |
|---------|-------------|
| Tools in `initialize()` only | Agent has 0 tools → silent failure |
| Not calling `register_mcp_tools()` | Agent doesn't know about MCP tools |
| Forgetting `await` on `initialize()` | Adapters not pre-warmed (minor) |
| Orchestrator not passing MCP to agent | Tools not available for that agent type |
