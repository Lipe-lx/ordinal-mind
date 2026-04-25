# Working Patterns — NTC em Produção

Padrões concretos por camada para trabalho dia-a-dia com NTC implementado.

---

## base.py — Loop NTC-first

### Estrutura completa do loop

```python
async def run(self, messages, tool_choice="auto", max_iterations=10) -> AgentResponse:
    history = list(messages)
    tools = skill_registry.to_native_tools(self.agent_id)

    if tool_choice == "none":
        tools = None  # política none: zerar completamente

    for iteration in range(max_iterations):
        response = await self.provider.generate(LLMRequest(
            messages=history,
            tools=tools,
            tool_choice=tool_choice if tools else None,
            max_tokens=self.max_tokens,
        ))

        history.append(response.message.to_dict())

        # Path 1: NTC — tool_calls estruturados
        if response.tool_calls:
            results = await self._execute_parallel(response.tool_calls)
            for r in results:
                history.append({
                    "role": "tool",
                    "tool_call_id": r.tool_call_id,
                    "name": r.name,
                    "content": r.content,
                })
            if tool_choice == "required":
                tool_choice = "auto"  # libera para resposta após primeira execução
            continue

        # Path 2: ReAct fallback (silencioso, sem log de erro)
        if self._looks_like_react_action(response.message.content):
            name, args = self._parse_react_action(response.message.content)
            result = await self._dispatch_tool(name, args)
            history.append({"role": "user", "content": f"Observation: {result}"})
            continue

        # Path 3: Resposta final
        return AgentResponse(
            content=response.message.content or "",
            tool_calls_made=self._extract_tool_names(history),
            iterations=iteration + 1,
        )

    return AgentResponse(content="", error="max_iterations_reached")
```

### Execução paralela

```python
async def _execute_parallel(self, tool_calls: list[ToolCallResponse]) -> list[ToolResult]:
    """Padrão ENG-AI: até 15 chamadas simultâneas via asyncio.gather."""
    async def execute_one(tc: ToolCallResponse) -> ToolResult:
        try:
            result = await self._dispatch_tool(tc.name, tc.arguments)
            return ToolResult(
                tool_call_id=tc.id,
                name=tc.name,
                content=json.dumps(result, ensure_ascii=False),
            )
        except Exception as e:
            logger.error("tool_execution_error", tool=tc.name, error=str(e))
            return ToolResult(
                tool_call_id=tc.id,
                name=tc.name,
                content=json.dumps({"error": str(e)}),
            )

    return await asyncio.gather(*[execute_one(tc) for tc in tool_calls])
```

---

## ToolPolicySelector — resolve_api_params

```python
# Padrão de uso no orchestrator:

from backend.src.services.tool_policy_selector import resolve_api_params
from backend.src.agents.skills.registry import skill_registry

turn_policy = await tool_policy_selector.resolve(
    operation=turn_operation,
    agent_id=agent_id,
)

params = resolve_api_params(turn_policy)
tools = skill_registry.to_native_tools(agent_id) if params["inject_tools"] else None
tool_choice = params["tool_choice"] if tools else None

response = await agent.run(
    messages=turn_messages,
    tool_choice=tool_choice,
)
```

---

## Mutation Guard — orchestrator.py

```python
# Após agent.run() em qualquer operação de mutação:

MUTATION_TOOLS = frozenset({
    "create_task", "update_task", "delete_task",
    "update_project_context", "create_milestone",
    "update_milestone", "delete_milestone",
    # adicionar novos tools de mutação aqui ao implementar
})

def verify_mutation_evidence(response: AgentResponse, operation: str) -> bool:
    if operation != "mutate":
        return True
    called = frozenset(response.tool_calls_made)
    ok = bool(called & MUTATION_TOOLS)
    if not ok:
        logger.warning("mutation_without_evidence",
                       tools_called=list(called), operation=operation)
    return ok

# Aplicar antes de retornar ao usuário:
if turn_operation == "mutate" and not verify_mutation_evidence(response, turn_operation):
    return build_safe_error_response("Não foi possível confirmar a operação. Tente novamente.")
```

---

## SkillRegistry — adicionando nova tool

```python
# backend/src/agents/skills/registry.py

# 1. Registrar o schema da nova tool:
_REGISTRY = {
    "geotechnical": [
        {
            "type": "function",
            "function": {
                "name": "get_spt_resistance",
                "description": "Busca resistência SPT por profundidade. Use para fundações e solos.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "depth_m": {"type": "number", "description": "Profundidade em metros"},
                        "soil_type": {
                            "type": "string",
                            "enum": ["argila", "areia", "silte", "rocha"],
                        },
                    },
                    "required": ["depth_m"],
                },
            },
        },
        # ... outras tools do agente
    ],
}

# 2. Verificar que o schema não tem keywords proibidas para Gemini:
#    - Sem $ref, $defs, anyOf, oneOf, additionalProperties
#    - "required" DEVE ser list[str], nunca bool ou string

# 3. Se for tool de mutação, adicionar nome em MUTATION_TOOLS no orchestrator.
```

---

## task_agent_runner.py — Runtime de Tasks

```python
# backend/src/services/task_agent_runner.py

async def run_task_agent(task: ProjectTask, project_context: dict) -> TaskResult:
    agent = agent_factory.get(task.agent_id)

    # Autonomia de task → tool_choice (lógica separada do ToolPolicySelector)
    if task.autonomy_mode == "full_autonomy":
        tool_choice = "required"
    elif task.autonomy_mode == "approval_delete_only":
        tool_choice = "auto"
    else:  # approval_required
        tool_choice = "auto"

    response = await agent.run(
        messages=build_task_messages(task, project_context),
        tool_choice=tool_choice,
        max_iterations=15,  # tasks podem ter loops mais longos
    )

    # Guard de mutação obrigatório para tasks com autonomia
    if task.has_pending_mutations:
        if not verify_mutation_evidence(response, "mutate"):
            if task.autonomy_mode == "full_autonomy":
                # Autonomia total: falha a task
                return TaskResult(status="failed", error="mutation_not_confirmed")
            else:
                # Outros modos: escala para aprovação humana
                await notify_approval_required(task)
                return TaskResult(status="pending_approval")

    return TaskResult(status="completed", output=response.content)
```

---

## TokenWindowMemory — remoção em grupo

```python
# backend/src/agents/memory/short_term.py

class TokenWindowMemory:
    def __init__(self, max_tokens: int = 6000):
        self.max_tokens = max_tokens
        self._messages: list[dict] = []

    def add(self, message: dict) -> None:
        self._messages.append(message)
        self._trim_if_needed()

    def _trim_if_needed(self) -> None:
        while self._count_tokens() > self.max_tokens and len(self._messages) > 2:
            self._remove_oldest_safe_group()

    def _remove_oldest_safe_group(self) -> None:
        """Remove o grupo mais antigo mantendo integridade de pares NTC."""
        for i, msg in enumerate(self._messages):
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                # Identifica todos os IDs deste turno
                call_ids = {tc["id"] for tc in msg["tool_calls"]}
                # Encontra fim do grupo de tool_results
                j = i + 1
                while j < len(self._messages):
                    m = self._messages[j]
                    if m.get("role") == "tool" and m.get("tool_call_id") in call_ids:
                        j += 1
                    else:
                        break
                del self._messages[i:j]  # remove atomicamente
                return
            if msg.get("role") == "user":
                self._messages.pop(i)
                return

    def _count_tokens(self) -> int:
        from backend.src.services.token_utils import count_messages_tokens
        return count_messages_tokens(self._messages)
```

---

## Streaming SSE — padrão completo

```python
# backend/src/api/orchestration/streaming.py

async def stream_agent_turn(
    agent: BaseAgent,
    messages: list[dict],
    tool_choice: str,
) -> AsyncGenerator[SSEEvent, None]:

    history = list(messages)
    tools = skill_registry.to_native_tools(agent.agent_id)
    if tool_choice == "none":
        tools = None

    current_tc = tool_choice
    max_iterations = 10

    for _ in range(max_iterations):
        accumulated: dict[int, dict] = {}
        final_content = ""

        async for chunk in agent.provider.stream(LLMRequest(
            messages=history,
            tools=tools,
            tool_choice=current_tc if tools else None,
        )):
            delta = chunk.delta

            if delta.content:
                final_content += delta.content
                yield SSEEvent(type="text_delta", content=delta.content)

            if delta.tool_calls:
                for tc in delta.tool_calls:
                    slot = accumulated.setdefault(
                        tc.index, {"id": "", "name": "", "arguments": ""}
                    )
                    if tc.id:        slot["id"] = tc.id
                    if tc.name:      slot["name"] += tc.name
                    if tc.arguments: slot["arguments"] += tc.arguments

            # Fim de turno com tool_calls (checar accumulated para Gemini)
            is_tool_turn = (
                chunk.finish_reason in ("tool_calls", "TOOL_USE")
                or (chunk.finish_reason in ("STOP", "stop") and accumulated)
            )

            if is_tool_turn and accumulated:
                tool_calls = [
                    ToolCallResponse(
                        id=v["id"],
                        name=v["name"],
                        arguments=json.loads(v["arguments"]),
                    )
                    for v in accumulated.values()
                ]

                yield SSEEvent(type="tool_calls_start", count=len(tool_calls))
                results = await agent._execute_parallel(tool_calls)

                # Atualiza histórico
                history.append({"role": "assistant", "content": final_content or None,
                                 "tool_calls": [tc.to_dict() for tc in tool_calls]})
                for r in results:
                    history.append({"role": "tool", "tool_call_id": r.tool_call_id,
                                    "name": r.name, "content": r.content})

                yield SSEEvent(type="tool_calls_done")

                if current_tc == "required":
                    current_tc = "auto"
                break  # próxima iteração do loop externo

            if chunk.finish_reason in ("stop", "end_turn", "STOP", "length"):
                yield SSEEvent(type="done")
                return

        else:
            # Nenhum tool_call nesta iteração → encerrou
            yield SSEEvent(type="done")
            return
```

---

## Smoke test — adicionando novo agente

```python
# Para validar um novo agente após adicionar tools no SkillRegistry:

# 1. Teste de policy=none (converse)
python backend/scripts/smoke_test_native_tc.py \
  --agent novo_agente \
  --message "Olá, como vai?" \
  --policy none \
  --expect-no-tool-calls

# 2. Teste de policy=auto (calculate)
python backend/scripts/smoke_test_native_tc.py \
  --agent novo_agente \
  --message "Calcule X para Y" \
  --policy auto

# 3. Teste de policy=required (se aplicável)
python backend/scripts/smoke_test_native_tc.py \
  --agent novo_agente \
  --message "Crie Z" \
  --policy required \
  --expect-mutation nome_da_tool_de_mutacao
```
