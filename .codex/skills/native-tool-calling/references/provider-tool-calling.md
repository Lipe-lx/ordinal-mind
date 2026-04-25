# Provider Tool Calling — Referência por Provider

> Abril 2026 | Arquitetura: providers nativos via `backend/src/llm/providers/`

O ENG-AI usa providers nativos (não LiteLLM uniforme) para injeção de tools.
Cada provider implementa `_generate()` e `_stream()` adaptados ao SDK próprio.

---

## Contratos compartilhados (types.py)

```python
# backend/src/llm/types.py

@dataclass
class LLMRequest:
    messages: list[dict]
    tools: list[dict] | None = None           # schemas OpenAI format
    tool_choice: str | dict | None = None     # "auto" | "required" | "none" | específico
    max_tokens: int = 8192
    model: str = ""

@dataclass
class ToolCallResponse:
    id: str
    name: str
    arguments: dict                            # já parseado como dict
    thought_signature: str | None = None       # base64, apenas Gemini 2.5 thinking

@dataclass
class LLMResponse:
    message: Message
    tool_calls: list[ToolCallResponse]         # lista vazia se não há tool calls
    finish_reason: str                         # normalizado pelo provider
    usage: UsageMetrics
```

---

## google.py — Gemini via google-genai SDK

### Injeção de tools

```python
# Converte schemas OpenAI → Gemini FunctionDeclaration
# Roda Schema Sanitizer antes de converter

tools_config = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name=t["function"]["name"],
        description=t["function"]["description"],
        parameters=_sanitize_schema_for_gemini(t["function"]["parameters"]),
    )
    for t in tools
])

tool_config = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(
        mode=_resolve_gemini_mode(tool_choice)  # + Gemma4 guard
    )
)
```

### Mapeamento tool_choice → Gemini mode

| tool_choice (ENG-AI) | Gemini mode | Notas |
|---|---|---|
| `"required"` | `ANY` | Gemma 4 guard rebaixa para `AUTO` |
| `"auto"` | `AUTO` | |
| `"none"` | `NONE` | |
| dict específico | `ANY` + allowed_function_names | |

### Detecção de tool_calls na resposta

```python
# finish_reason Gemini não é confiável com tools
# Sempre checar os dois:
has_tool_calls = (
    response.candidates[0].finish_reason.name in ("TOOL_USE",)
    or any(part.function_call for part in response.candidates[0].content.parts)
)
```

### thought_signature — ciclo de vida completo

```python
# 1. Captura na resposta (apenas gemini-2.5-*)
for part in candidate.content.parts:
    if part.function_call:
        thought_sig = None
        if hasattr(part, "thought_signature") and part.thought_signature:
            thought_sig = base64.b64encode(part.thought_signature).decode()
        tool_calls.append(ToolCallResponse(
            id=generate_id(),
            name=part.function_call.name,
            arguments=dict(part.function_call.args),
            thought_signature=thought_sig,
        ))

# 2. Persistência: ToolCallResponse vai para o histórico serializado

# 3. Restauração ao reconstruir histórico para próxima chamada
def _rebuild_function_call_part(tc: ToolCallResponse, current_model: str):
    part = types.Part(function_call=types.FunctionCall(
        name=tc.name,
        args=tc.arguments,
    ))
    if tc.thought_signature and current_model.startswith("gemini-2.5"):
        part.thought_signature = base64.b64decode(tc.thought_signature)
    # Se cross-model: omite thought_signature — evita 400
    return part
```

### Schema Sanitizer — keywords removidas

```python
UNSUPPORTED_KEYWORDS = {
    "$ref", "$defs", "$schema", "anyOf", "oneOf", "allOf",
    "exclusiveMinimum", "exclusiveMaximum", "not",
    "additionalProperties", "unevaluatedProperties",
    "if", "then", "else", "dependentSchemas",
}

def _sanitize_schema_for_gemini(schema: dict) -> dict:
    if not isinstance(schema, dict):
        return schema
    cleaned = {}
    for k, v in schema.items():
        if k in UNSUPPORTED_KEYWORDS:
            continue  # remove
        if k == "properties" and isinstance(v, dict):
            cleaned[k] = {pk: _sanitize_schema_for_gemini(pv) for pk, pv in v.items()}
        elif k == "items":
            cleaned[k] = _sanitize_schema_for_gemini(v)
        else:
            cleaned[k] = v
    return cleaned
```

### Model Fallback

```python
FALLBACK_MODEL = "gemini-2.5-flash"
RETRYABLE_CODES = (503, 429, 500)

async def _generate_with_fallback(self, request: LLMRequest) -> LLMResponse:
    for attempt in range(4):
        try:
            return await self._generate(request)
        except google.api_core.exceptions.GoogleAPIError as e:
            if e.code not in RETRYABLE_CODES or attempt == 3:
                raise
            if attempt == 3:
                request = dataclasses.replace(request, model=FALLBACK_MODEL)
            await asyncio.sleep(2 ** attempt)
```

---

## openai.py — OpenAI / Groq

### Injeção de tools

```python
# Schemas já no formato OpenAI — passagem direta
response = await client.chat.completions.create(
    model=request.model,
    messages=request.messages,
    tools=request.tools,          # list[dict] direto
    tool_choice=request.tool_choice,
    max_tokens=request.max_tokens,
)
```

### Detecção de tool_calls

```python
choice = response.choices[0]
# finish_reason confiável no OpenAI:
if choice.finish_reason == "tool_calls":
    tool_calls = [
        ToolCallResponse(
            id=tc.id,
            name=tc.function.name,
            arguments=json.loads(tc.function.arguments),
        )
        for tc in choice.message.tool_calls
    ]
```

### Streaming OpenAI

```python
# Argumentos chegam fragmentados — acumular por index
accumulated: dict[int, dict] = {}
async for chunk in stream:
    for tc in (chunk.choices[0].delta.tool_calls or []):
        slot = accumulated.setdefault(tc.index, {"id":"","name":"","arguments":""})
        if tc.id:              slot["id"] = tc.id
        if tc.function.name:   slot["name"] += tc.function.name
        if tc.function.arguments: slot["arguments"] += tc.function.arguments

# Ao final (finish_reason == "tool_calls"):
tool_calls = [
    ToolCallResponse(id=v["id"], name=v["name"], arguments=json.loads(v["arguments"]))
    for v in accumulated.values()
]
```

---

## anthropic.py — Claude

### Injeção de tools

```python
# Anthropic usa "tools" com input_schema (não "parameters")
anthropic_tools = [
    {
        "name": t["function"]["name"],
        "description": t["function"]["description"],
        "input_schema": t["function"]["parameters"],  # renomear "parameters" → "input_schema"
    }
    for t in tools
]

response = await client.messages.create(
    model=request.model,
    messages=request.messages,
    tools=anthropic_tools,
    tool_choice=_map_tool_choice_anthropic(request.tool_choice),
    max_tokens=request.max_tokens,
)
```

### Mapeamento tool_choice → Anthropic

| tool_choice (ENG-AI) | Anthropic format |
|---|---|
| `"auto"` | `{"type": "auto"}` |
| `"required"` | `{"type": "any"}` |
| `"none"` | `{"type": "none"}` |
| dict específico | `{"type": "tool", "name": "X"}` |

### Detecção de tool_calls

```python
# finish_reason Anthropic: "tool_use" (não "tool_calls")
if response.stop_reason == "tool_use":
    tool_calls = [
        ToolCallResponse(
            id=block.id,
            name=block.name,
            arguments=block.input,  # já é dict
        )
        for block in response.content
        if block.type == "tool_use"
    ]
```

---

## Injeção de tool_results no histórico — por provider

### OpenAI / Groq format

```python
{"role": "tool", "tool_call_id": "call_abc", "name": "tool_name", "content": "json_string"}
```

### Anthropic format

```python
{"role": "user", "content": [
    {"type": "tool_result", "tool_use_id": "toolu_abc", "content": "json_string"}
]}
```

### Gemini format (reconstrução de history)

```python
# Gemini não usa "role=tool" — usa Content com role="model" + "user" alternados
# O provider reconstrói o histórico no formato google-genai antes de cada chamada
```

---

## Erros comuns por provider

| Erro | Provider | Causa | Solução |
|---|---|---|---|
| `400 INVALID_ARGUMENT` | Gemini | thought_signature cross-model | Não restaurar se modelo mudou |
| `400 INVALID_ARGUMENT` | Gemini | Schema com $ref/$defs | Schema Sanitizer ou limpar na origem |
| `400 tool_choice=ANY density` | Gemini/Gemma4 | Muitas tools com mode=ANY | Gemma4 guard ativo |
| `400 tool_choice requires tools` | Todos | tools=None com tool_choice definido | Zerar tool_choice junto com tools |
| `JSONDecodeError` | OpenAI/Groq | Argumentos acumulados errado no stream | Acumular string completa antes de parsear |
| `422 tool_result without tool_call` | Anthropic | Órfão no histórico | TokenWindowMemory remoção em grupo |
| `503/429` | Gemini | Rate limit / sobrecarga | Fallback com backoff ativo |
