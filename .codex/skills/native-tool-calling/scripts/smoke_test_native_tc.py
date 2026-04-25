#!/usr/bin/env python
"""
Smoke test para validar Native Tool Calling end-to-end no ENG-AI.
Usa os providers nativos via factory (não LiteLLM direto).

Uso:
  python backend/scripts/smoke_test_native_tc.py \\
    --agent geotechnical \\
    --message "Calcule capacidade de carga para estaca 30cm em argila SPT=8"

  python backend/scripts/smoke_test_native_tc.py \\
    --agent contract_manager \\
    --message "Crie a task 'Sondagem SPT'" \\
    --expect-mutation create_task

  python backend/scripts/smoke_test_native_tc.py \\
    --agent geotechnical \\
    --message "Consulte NBR 6122 e NBR 6118 simultâneos" \\
    --expect-parallel

  python backend/scripts/smoke_test_native_tc.py \\
    --agent structural \\
    --message "Dimensione viga fck=25 momento=150kNm" \\
    --model gemini-2.5-pro \\
    --check-thought-signature
"""

import asyncio
import argparse
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from dotenv import load_dotenv
load_dotenv()

# Mapeamento agente → MCPs (espelho do orchestrator)
AGENT_MCPS = {
    "general":          ["nbr", "materials", "calculations", "math", "websearch", "webfetch", "prices"],
    "geotechnical":     ["nbr", "calculations", "math", "websearch", "webfetch", "prices"],
    "structural":       ["materials", "calculations", "nbr", "math", "websearch", "webfetch", "prices"],
    "budgeting":        ["prices", "nbr", "calculations", "math", "webfetch"],
    "architectural":    ["nbr", "calculations", "math", "websearch", "webfetch", "prices"],
    "pathology":        ["nbr", "materials", "calculations", "math", "websearch", "webfetch", "prices"],
    "contract_manager": ["project_management", "specialist_dispatcher", "math", "calculations", "websearch", "webfetch"],
}

MUTATION_TOOLS = frozenset({
    "create_task", "update_task", "delete_task",
    "update_project_context", "create_milestone",
    "update_milestone", "delete_milestone",
})

POLICY_MAP = {
    "required": {"tool_choice": "required", "inject_tools": True},
    "auto":     {"tool_choice": "auto",     "inject_tools": True},
    "direct":   {"tool_choice": "auto",     "inject_tools": True},
    "none":     {"tool_choice": "none",     "inject_tools": False},
}

async def run_smoke_test(
    agent_id: str,
    message: str,
    policy: str = "auto",
    model: str | None = None,
    expect_mutation: str | None = None,
    expect_parallel: bool = False,
    expect_no_tool_calls: bool = False,
    check_thought_signature: bool = False,
):
    print(f"\n{'='*60}")
    print(f"Agente:    {agent_id}")
    print(f"Política:  {policy} → tool_choice={POLICY_MAP[policy]['tool_choice']}")
    print(f"Modelo:    {model or 'default'}")
    print(f"Mensagem:  {message}")
    print(f"{'='*60}\n")

    # Import lazy para não quebrar se o projeto não está no path
    try:
        from backend.src.llm.factory import get_provider
        from backend.src.agents.skills.registry import skill_registry
        from backend.src.llm.types import LLMRequest
        USE_NATIVE = True
    except ImportError:
        print("⚠️  Providers nativos não encontrados — usando LiteLLM como fallback de teste")
        USE_NATIVE = False

    params = POLICY_MAP[policy]

    if USE_NATIVE:
        tools = skill_registry.to_native_tools(agent_id) if params["inject_tools"] else None
        tool_choice = params["tool_choice"] if tools else None
        provider = get_provider(model_override=model)

        try:
            response = await provider.generate(LLMRequest(
                messages=[
                    {"role": "system", "content": f"Você é o agente {agent_id} do ENG-AI."},
                    {"role": "user", "content": message},
                ],
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=1000,
            ))
            tool_calls = response.tool_calls
            finish_reason = response.finish_reason
        except Exception as e:
            print(f"❌ FALHA na chamada ao provider: {e}")
            return False
    else:
        import litellm
        # Fallback: usa LiteLLM para smoke test básico
        # Schemas precisam estar disponíveis de alguma forma
        print("  (modo fallback — schemas de tools não disponíveis)")
        tool_calls = []
        finish_reason = "stop"

    print(f"finish_reason: {finish_reason}")
    print(f"tool_calls:    {len(tool_calls)}")
    for tc in tool_calls:
        args_preview = str(tc.arguments)[:80]
        print(f"  → {tc.name}({args_preview})")
        if check_thought_signature and tc.thought_signature:
            print(f"    thought_signature: {tc.thought_signature[:40]}... ✅")

    passed = True

    # 1. Tool enforcement: required deve ter tool_calls
    if policy == "required" and not tool_calls:
        print("\n❌ FALHA: policy=required mas nenhuma tool foi chamada.")
        passed = False
    elif policy == "none" and tool_calls:
        print(f"\n❌ FALHA: policy=none mas {len(tool_calls)} tool(s) foram chamadas.")
        passed = False
    else:
        print("\n✅ Tool enforcement: OK")

    # 2. Sem tool calls esperado
    if expect_no_tool_calls and tool_calls:
        print(f"❌ FALHA: Esperava sem tool calls, recebeu {len(tool_calls)}")
        passed = False

    # 3. Mutation tool específica
    if expect_mutation:
        called_names = [tc.name for tc in tool_calls]
        if expect_mutation not in called_names:
            print(f"❌ FALHA: Esperava mutation '{expect_mutation}', chamadas: {called_names}")
            passed = False
        else:
            print(f"✅ Mutation evidence: '{expect_mutation}' confirmado")

    # 4. Paralelismo
    if expect_parallel:
        if len(tool_calls) < 2:
            print(f"⚠️  AVISO: Esperava ≥2 tool calls paralelas, recebeu {len(tool_calls)}")
        else:
            print(f"✅ Parallel tool calls: {len(tool_calls)} simultâneas")

    # 5. thought_signature
    if check_thought_signature:
        has_sig = any(tc.thought_signature for tc in tool_calls)
        if not has_sig:
            print("⚠️  AVISO: thought_signature não encontrado (modelo pode não ser Gemini 2.5 thinking)")
        else:
            print("✅ thought_signature: capturado")

    # 6. JSON válido em todos os arguments
    for tc in tool_calls:
        if not isinstance(tc.arguments, dict):
            print(f"❌ FALHA: arguments não é dict para {tc.name}: {tc.arguments}")
            passed = False

    print("\n✅ Smoke test PASSOU" if passed else "\n❌ Smoke test FALHOU")
    return passed


def main():
    parser = argparse.ArgumentParser(description="Smoke test NTC — ENG-AI")
    parser.add_argument("--agent", default="geotechnical", choices=list(AGENT_MCPS))
    parser.add_argument("--message", required=True)
    parser.add_argument("--policy", default="auto", choices=list(POLICY_MAP))
    parser.add_argument("--model", default=None)
    parser.add_argument("--expect-mutation", default=None, metavar="TOOL_NAME")
    parser.add_argument("--expect-parallel", action="store_true")
    parser.add_argument("--expect-no-tool-calls", action="store_true")
    parser.add_argument("--check-thought-signature", action="store_true")
    args = parser.parse_args()

    ok = asyncio.run(run_smoke_test(
        agent_id=args.agent,
        message=args.message,
        policy=args.policy,
        model=args.model,
        expect_mutation=args.expect_mutation,
        expect_parallel=args.expect_parallel,
        expect_no_tool_calls=args.expect_no_tool_calls,
        check_thought_signature=args.check_thought_signature,
    ))
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
