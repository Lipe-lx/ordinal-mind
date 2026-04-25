---
name: native-tool-calling
description: >
  Use este skill sempre que for implementar, estender ou depurar chamadas de ferramentas
  (tool calling) no ENG-AI. O NTC (Native Tool Calling) já está implementado desde abril
  de 2026 como padrão principal — este skill documenta a arquitetura real em produção,
  não uma migração. Cobre: SkillRegistry.to_native_tools(), os 4 modos do ToolPolicySelector
  (required/auto/direct/none), loop NTC-first em base.py com fallback ReAct silencioso,
  thought_signature do Gemini 2.5, Schema Sanitizer, Gemma 4 guard, model fallback com
  backoff, TokenWindowMemory com remoção segura de pares, streaming SSE, e Mutation Guard
  determinístico. Acionar sempre que o usuário mencionar: tool use, function calling,
  tool_choice, SkillRegistry, thought_signature, schema sanitizer, parallel tool calls,
  mutation guard, ou qualquer trabalho nos arquivos base.py, tool_policy_selector.py,
  providers/ ou orchestrator.py.
---

# Native Tool Calling — ENG-AI Reference Skill

## Estado atual (abril 2026)

O NTC está **implementado e em produção**. O padrão é NTC-first com fallback ReAct
silencioso. Este skill é uma referência de trabalho, não um guia de migração.

### Arquitetura NTC-first

```
SkillRegistry.to_native_tools()
        ↓
Provider (google.py | openai.py | anthropic.py)
  └─ injeção nativa de tools + tool_choice na chamada LLM
        ↓
LLMResponse com tool_calls estruturados
        ↓
base.py agent loop
  ├─ finish_reason == "tool_calls" → executa → injeta tool_results → continua
  ├─ finish_reason == "stop/end_turn" → retorna resposta final
  └─ texto sem tool_calls → fallback ReAct parser (silencioso)
```

### Arquivos centrais

```
backend/src/agents/base.py                    ← Loop NTC-first + fallback ReAct
backend/src/agents/skills/registry.py         ← to_native_tools() — fonte canônica de schemas
backend/src/llm/types.py                      ← LLMRequest, LLMResponse, ToolCallResponse
backend/src/llm/providers/google.py           ← Gemini: sanitizer, thought_sig, Gemma4 guard, backoff
backend/src/llm/providers/openai.py           ← OpenAI/Groq: injeção nativa
backend/src/llm/providers/anthropic.py        ← Claude: injeção nativa
backend/src/llm/factory.py                    ← get_provider() por ModelFamily (lazy)
backend/src/services/tool_policy_selector.py  ← 4 políticas → tool_choice
backend/src/agents/memory/short_term.py       ← TokenWindowMemory com remoção segura de pares
backend/src/api/orchestrator.py               ← Mutation Guard determinístico
```

Leia `references/provider-tool-calling.md` para contratos por provider e gotchas.
Leia `references/working-patterns.md` para padrões concretos de cada camada.

---

## SkillRegistry — Fonte Canônica de Schemas

**Não usar dicts manuais nem registry separado.** O caminho canônico é
`SkillRegistry.to_native_tools()`:

```python
# backend/src/agents/skills/registry.py
class SkillRegistry:
    def to_native_tools(self, agent_id: str) -> list[dict]:
        """
        Converte skills registradas para o formato OpenAI tool schema.
        Chamado pelo provider antes de injetar na API.
        Retorna lista vazia para agentes sem tools (ex: modo converse).
        """
        ...

# Uso no provider / base.py:
tools = skill_registry.to_native_tools(agent_id=self.agent_id)
```

**Padrão de schema dentro do SkillRegistry:**

```python
{
    "type": "function",
    "function": {
        "name": "calculate_bearing_capacity",
        "description": "Calcula capacidade de carga de fundação. Use para SPT, estacas e sapatas.",
        "parameters": {
            "type": "object",
            "properties": {
                "foundation_type": {
                    "type": "string",
                    "enum": ["sapata", "estaca", "tubulao"],
                    "description": "Tipo de fundação"
                },
                "depth_m": {
                    "type": "number",
                    "description": "Profundidade em metros"
                }
            },
            "required": ["foundation_type", "depth_m"]
        }
    }
}
```

**Regras de qualidade para descriptions:**
- Imperativo curto + quando usar. O modelo usa description para decidir qual tool chamar.
- Nunca deixar vazio — description vazia causa seleção aleatória.
- Parâmetros com `description` detalhada evitam alucinação de formato.
- Schemas NÃO devem conter: `$ref`, `$defs`, `anyOf`/`oneOf`, `exclusiveMinimum`,
  `additionalProperties` — o Schema Sanitizer do Google provider remove automaticamente,
  mas schemas limpos evitam overhead e erros em outros providers.

---

## ToolPolicySelector — 4 Políticas

O `ToolPolicySelector` retorna uma das 4 políticas que mapeiam diretamente para o
comportamento da chamada LLM:

| Política | tool_choice | tools | Quando usar |
|---|---|---|---|
| `required` | `"required"` | injetadas | Mutações, execute_task — modelo DEVE chamar tool |
| `auto` | `"auto"` | injetadas | calculate, audit, validate — modelo decide livremente |
| `direct` | `"auto"` | injetadas | extract, summarize — prefere texto mas CAN usar tool |
| `none` | `"none"` | `null` | converse — tools completamente desabilitadas |

```python
# backend/src/services/tool_policy_selector.py
POLICY_TO_API_PARAMS: dict[str, dict] = {
    "required": {"tool_choice": "required", "inject_tools": True},
    "auto":     {"tool_choice": "auto",     "inject_tools": True},
    "direct":   {"tool_choice": "auto",     "inject_tools": True},
    "none":     {"tool_choice": "none",     "inject_tools": False},
}

def resolve_api_params(policy: str) -> dict:
    return POLICY_TO_API_PARAMS.get(policy, POLICY_TO_API_PARAMS["required"])
```

```python
# Uso no orchestrator / base.py:
params = resolve_api_params(turn_policy)
tools = skill_registry.to_native_tools(agent_id) if params["inject_tools"] else None
tool_choice = params["tool_choice"] if tools else None
```

**Mapeamento por operação:**

| Operação | Política típica |
|---|---|
| `converse` | `none` |
| `summarize`, `extract`, `explain`, `compare_literal` | `direct` |
| `calculate`, `audit`, `validate`, `simulate`, `recommend`, `quote_norm`, `lookup_external` | `auto` |
| `mutate`, `execute_task` | `required` |

---

## Loop NTC-first em base.py

```python
# backend/src/agents/base.py

async def run(
    self,
    messages: list[dict],
    tool_choice: str | None = "auto",
    max_iterations: int = 10,
) -> AgentResponse:

    history = list(messages)
    tools = skill_registry.to_native_tools(self.agent_id)

    # Política none: zerar tools completamente
    if tool_choice == "none":
        tools = None

    for iteration in range(max_iterations):
        llm_response: LLMResponse = await self.provider.generate(LLMRequest(
            messages=history,
            tools=tools,
            tool_choice=tool_choice,
            max_tokens=self.max_tokens,
        ))

        assistant_msg = llm_response.message
        history.append(assistant_msg.to_dict())

        # ── NTC path: tool_calls estruturados ──────────────────────────────
        if llm_response.tool_calls:
            results = await self._execute_parallel(llm_response.tool_calls)

            for r in results:
                history.append({
                    "role": "tool",
                    "tool_call_id": r.tool_call_id,
                    "name": r.name,
                    "content": r.content,   # sempre JSON string
                })

            # Após primeira execução em required, libera para o modelo responder
            if tool_choice == "required":
                tool_choice = "auto"

            continue

        # ── Fallback ReAct: texto puro (silencioso) ─────────────────────────
        if self._looks_like_react_action(assistant_msg.content):
            tool_name, tool_args = self._parse_react_action(assistant_msg.content)
            result = await self._dispatch_tool(tool_name, tool_args)
            history.append({"role": "user", "content": f"Observation: {result}"})
            continue

        # ── Resposta final ──────────────────────────────────────────────────
        return AgentResponse(
            content=assistant_msg.content or "",
            tool_calls_made=self._extract_tool_names(history),
            iterations=iteration + 1,
        )

    return AgentResponse(content="", error="max_iterations_reached")

async def _execute_parallel(self, tool_calls: list[ToolCallResponse]) -> list[ToolResult]:
    """Até 15 chamadas paralelas — padrão ENG-AI."""
    import asyncio
    return await asyncio.gather(*[self._execute_one(tc) for tc in tool_calls])
```

---

## Providers — Injeção Nativa por Provider

O `factory.py` instancia o provider correto via `get_provider(model_family)`. Cada
provider implementa `_generate()` e `_stream()` com sua própria injeção nativa.

### google.py — Especificidades Gemini

**1. Schema Sanitizer**

Gemini rejeita keywords JSON Schema não suportadas. O sanitizer roda automaticamente
antes de cada chamada com tools:

```python
def _sanitize_schema_for_gemini(schema: dict) -> dict:
    """
    Remove: $ref, $defs, anyOf, oneOf, exclusiveMinimum, additionalProperties.
    Resolve $ref inline quando possível. Recursivo em properties aninhadas.
    """
    ...

# Chamado em _build_tools_for_gemini():
sanitized = [_sanitize_schema_for_gemini(t) for t in tools]
```

**2. thought_signature — Gemini 2.5 Thinking**

Modelos thinking (gemini-2.5-*) retornam `thought_signature` nas parts de `functionCall`.
Capturar, persistir e restaurar com cautela:

```python
class ToolCallResponse:
    name: str
    arguments: dict
    thought_signature: str | None = None  # base64, apenas Gemini 2.5

# Restauração ao reconstruir histórico:
# SOMENTE se o modelo atual ainda é Gemini 2.5
# Cruzar modelos causa 400 INVALID_ARGUMENT

def _restore_thought_signature(tc: ToolCallResponse, current_model: str) -> bytes | None:
    if not tc.thought_signature:
        return None
    if not current_model.startswith("gemini-2.5"):
        return None  # não restaurar cross-model
    return base64.b64decode(tc.thought_signature)
```

**3. Gemma 4 Compatibility Guard**

Gemma 4 não suporta `tool_choice.mode="ANY"` com densidade alta de ferramentas:

```python
def _apply_gemma4_guard(tool_config: dict, model: str) -> dict:
    if "gemma-4" in model.lower() and tool_config.get("mode") == "ANY":
        tool_config["mode"] = "AUTO"
    return tool_config
```

**4. finish_reason Gemini**

Gemini pode retornar `finish_reason="STOP"` mesmo com tool_calls presentes:

```python
# Checar os dois — nunca confiar só no finish_reason com Gemini:
has_tool_calls = response.finish_reason == "tool_calls" or bool(response.tool_calls)
```

**5. Model Fallback com Backoff**

```python
FALLBACK_MODEL = "gemini-2.5-flash"
MAX_RETRIES = 4

async def _generate_with_fallback(request: LLMRequest) -> LLMResponse:
    for attempt in range(MAX_RETRIES):
        try:
            return await self._generate(request)
        except (ServiceUnavailable, RateLimitError):
            if attempt == MAX_RETRIES - 1:
                request.model = FALLBACK_MODEL  # última tentativa: fallback
            await asyncio.sleep(2 ** attempt)   # 1s → 2s → 4s → 8s
```

---

## Mutation Guard — 3-Layer Defense (estado atual)

**Camada 0:** `OperationSelector` classifica como `mutate` → `ToolPolicySelector`
retorna `required` → provider injeta `tool_choice="required"`.

**Camada 1:** Enforcement via API — não há mais nudge de texto. Se o modelo não chamar
tool com `required`, a API retorna erro antes de chegar ao guard.

**Camada 2 (Post-Loop Guard):** Checagem determinística:

```python
MUTATION_TOOLS = frozenset({
    "create_task", "update_task", "delete_task",
    "update_project_context", "create_milestone",
    "update_milestone", "delete_milestone",
})

def verify_mutation_evidence(response: AgentResponse, operation: str) -> bool:
    if operation != "mutate":
        return True
    confirmed = bool(frozenset(response.tool_calls_made) & MUTATION_TOOLS)
    if not confirmed:
        logger.warning("mutation_without_evidence", tools=response.tool_calls_made)
    return confirmed

if not verify_mutation_evidence(response, turn_operation):
    return SAFE_MUTATION_ERROR_RESPONSE
```

**Camada 3:** Constraint Injection permanece no system prompt como reforço semântico.

---

## TokenWindowMemory — Remoção Segura de Pares

Com NTC, remover `assistant+tool_calls` sem remover os `tool` correspondentes gera
órfãos que quebram a API:

```python
def _remove_oldest_safe_group(self) -> None:
    for i, msg in enumerate(self._messages):
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            call_ids = {tc["id"] for tc in msg["tool_calls"]}
            j = i + 1
            while j < len(self._messages):
                if (self._messages[j].get("role") == "tool"
                        and self._messages[j].get("tool_call_id") in call_ids):
                    j += 1
                else:
                    break
            del self._messages[i:j]  # remove grupo inteiro atomicamente
            return
        if msg.get("role") == "user":
            self._messages.pop(i)
            return
```

---

## Streaming SSE com Tool Calls

Argumentos chegam fragmentados — acumular antes de parsear JSON:

```python
async def stream_agent_turn(request):
    accumulated: dict[int, dict] = {}

    async for chunk in provider.stream(llm_request):
        if chunk.delta.content:
            yield SSEEvent(type="text_delta", content=chunk.delta.content)

        if chunk.delta.tool_calls:
            for tc in chunk.delta.tool_calls:
                slot = accumulated.setdefault(tc.index, {"id":"","name":"","arguments":""})
                if tc.id:        slot["id"] = tc.id
                if tc.name:      slot["name"] += tc.name
                if tc.arguments: slot["arguments"] += tc.arguments

        # Gemini: checar accumulated mesmo com finish_reason="STOP"
        if chunk.finish_reason in ("tool_calls",) or (chunk.finish_reason == "STOP" and accumulated):
            tool_calls = [ToolCallResponse(**v) for v in accumulated.values()]
            results = await agent._execute_parallel(tool_calls)
            accumulated = {}
            yield SSEEvent(type="tool_calls_done")
```

---

## Armadilhas e Gotchas

**1. tool_choice="required" com tools=None**
→ API retorna erro. `policy="none"` deve zerar tools E tool_choice juntos.

**2. thought_signature cross-model**
→ NUNCA restaurar se o modelo mudou. Causa `400 INVALID_ARGUMENT` imediato.

**3. Gemini finish_reason="STOP" com tool_calls**
→ Sempre checar `bool(response.tool_calls)` além de `finish_reason`.

**4. Schemas com $ref/$defs**
→ Sanitizer do google.py resolve, mas escrever schemas sem $ref desde o início.

**5. Gemma 4 com required**
→ Guard rebaixa para "auto" — enforcement não garantido. Não usar Gemma 4 em agentes
que dependem de `required`.

**6. Seletores leves não usam NTC**
→ AgentSelector, OperationSelector, ToolPolicySelector usam Flash Lite com JSON simples.
→ Não passar tools nesses fluxos.

**7. task_agent_runner.py — contexto adicional**
→ Autonomia (`full_autonomy` → `required`, outros → `auto`) é aplicada no runner,
não no ToolPolicySelector.

**8. Remoção de pares no TokenWindowMemory**
→ Sempre remover grupo `assistant+tool_calls` + `tool_results` atomicamente.

---

## Checklist de Validação

```bash
# Testes unitários
./.venv/bin/python -m pytest -q \
  backend/tests/test_tool_policy_selector.py \
  backend/tests/test_mutation_guard.py \
  backend/tests/test_base_agent_ntc.py \
  backend/tests/test_gemini_schema_sanitizer.py \
  -v

# Smoke tests por agente
./.venv/bin/python backend/scripts/smoke_test_native_tc.py \
  --agent geotechnical \
  --message "Calcule capacidade de carga para estaca de 30cm em argila mole SPT=8"

./.venv/bin/python backend/scripts/smoke_test_native_tc.py \
  --agent contract_manager \
  --message "Crie a task 'Sondagem SPT' no projeto atual" \
  --expect-mutation create_task

./.venv/bin/python backend/scripts/smoke_test_native_tc.py \
  --agent geotechnical \
  --message "Consulte NBR 6122 e NBR 6118 e calcule o fator de segurança" \
  --expect-parallel

./.venv/bin/python backend/scripts/smoke_test_native_tc.py \
  --agent structural \
  --message "Dimensione viga fck=25 com momento de 150 kNm" \
  --model gemini-2.5-pro \
  --check-thought-signature
```

---

## Referências

- `references/provider-tool-calling.md` — Contratos por provider, finish_reason, erros comuns
- `references/working-patterns.md` — Padrões concretos por camada
- `scripts/smoke_test_native_tc.py` — Validação end-to-end com CLI
