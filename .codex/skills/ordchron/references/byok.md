# BYOK — Chronicle Synthesizer agnóstico de provedor

O Chronicle Synthesizer roda **inteiramente no browser** com a key do usuário.
O Worker nunca vê a key. A key fica em `sessionStorage` (nunca localStorage).

---

## Detecção de provedor e contrato comum

```typescript
// src/app/lib/byok/index.ts

import type { ChronicleEvent, InscriptionMeta } from "../types"
import { AnthropicAdapter } from "./anthropic"
import { OpenAIAdapter } from "./openai"
import { GeminiAdapter } from "./gemini"

export type Provider = "anthropic" | "openai" | "gemini" | "unknown"

export interface LLMAdapter {
  synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string>
  provider: Provider
}

export function detectProvider(key: string): Provider {
  if (key.startsWith("sk-ant-"))  return "anthropic"
  if (key.startsWith("sk-"))      return "openai"
  if (key.startsWith("AIza"))     return "gemini"
  return "unknown"
}

export function createAdapter(key: string): LLMAdapter | null {
  const provider = detectProvider(key)
  switch (provider) {
    case "anthropic": return new AnthropicAdapter(key)
    case "openai":    return new OpenAIAdapter(key)
    case "gemini":    return new GeminiAdapter(key)
    default:          return null
  }
}

// gerenciamento da key em sessionStorage
export const KeyStore = {
  get: (): string | null => sessionStorage.getItem("ordinal-mind_llm_key"),
  set: (key: string) => sessionStorage.setItem("ordinal-mind_llm_key", key),
  clear: () => sessionStorage.removeItem("ordinal-mind_llm_key"),
  has: (): boolean => !!sessionStorage.getItem("ordinal-mind_llm_key"),
}
```

---

## Prompt do Chronicle Synthesizer

O mesmo prompt é usado pelos 3 adapters — mudança apenas no formato da chamada.

```typescript
// src/app/lib/byok/prompt.ts

import type { ChronicleEvent, InscriptionMeta } from "../types"

export function buildChroniclePrompt(meta: InscriptionMeta, events: ChronicleEvent[]): string {
  const eventsText = events
    .map(e => `[${e.timestamp.substring(0, 10)}] ${e.event_type.toUpperCase()}: ${e.description}`)
    .join("\n")

  return `Você é um cronista de artefatos digitais Bitcoin. Escreva um Chronicle factual e conciso
para esta inscrição Ordinal. Use apenas os dados fornecidos. Não invente informações.
Escreva em português. Tom: objetivo, com leve peso histórico. Máximo 4 parágrafos curtos.

DADOS DA INSCRIÇÃO:
- ID: ${meta.inscription_id}
- Número: #${meta.inscription_number}
- Sat: ${meta.sat.toLocaleString("pt-BR")} (raridade: ${meta.sat_rarity})
- Tipo de conteúdo: ${meta.content_type}
- Bloco genesis: ${meta.genesis_block}
- Dono atual: ${meta.owner_address}
${meta.collection ? `- Coleção: ${meta.collection.name ?? "sem nome"}` : ""}

LINHA DO TEMPO DE EVENTOS:
${eventsText}

Escreva o Chronicle agora. Cada fato deve ter respaldo nos dados acima.
Se uma informação não está nos dados, não mencione.`
}
```

---

## Adapter Anthropic

```typescript
// src/app/lib/byok/anthropic.ts

import type { LLMAdapter } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = "anthropic" as const
  constructor(private key: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",   // barato e rápido para síntese
        max_tokens: 600,
        messages: [{ role: "user", content: buildChroniclePrompt(meta, events) }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = await res.json()
    return data.content?.[0]?.text ?? ""
  }
}
```

---

## Adapter OpenAI

```typescript
// src/app/lib/byok/openai.ts

import type { LLMAdapter } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class OpenAIAdapter implements LLMAdapter {
  readonly provider = "openai" as const
  constructor(private key: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 600,
        messages: [{ role: "user", content: buildChroniclePrompt(meta, events) }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ""
  }
}
```

---

## Adapter Gemini

```typescript
// src/app/lib/byok/gemini.ts

import type { LLMAdapter } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class GeminiAdapter implements LLMAdapter {
  readonly provider = "gemini" as const
  constructor(private key: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.key}`

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildChroniclePrompt(meta, events) }] }],
        generationConfig: { maxOutputTokens: 600 },
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Gemini error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  }
}
```

---

## Hook React para síntese

```typescript
// src/app/lib/byok/useSynthesize.ts

import { useState, useCallback } from "react"
import { createAdapter, KeyStore } from "./index"
import type { Chronicle } from "../types"

export function useSynthesize() {
  const [narrative, setNarrative] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const synthesize = useCallback(async (chronicle: Chronicle) => {
    const key = KeyStore.get()
    if (!key) {
      setError("Cole sua API key para gerar o Chronicle narrative")
      return
    }

    const adapter = createAdapter(key)
    if (!adapter) {
      setError("API key inválida. Use uma key da Anthropic (sk-ant-), OpenAI (sk-) ou Gemini (AIza)")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const text = await adapter.synthesize(chronicle.meta, chronicle.events)
      setNarrative(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro na síntese")
    } finally {
      setLoading(false)
    }
  }, [])

  return { narrative, loading, error, synthesize }
}
```

---

## BYOKModal component

```tsx
// src/app/components/BYOKModal.tsx

import { useState } from "react"
import { KeyStore, detectProvider } from "../lib/byok"

interface Props {
  onClose: () => void
}

export function BYOKModal({ onClose }: Props) {
  const [key, setKey] = useState(KeyStore.get() ?? "")
  const provider = detectProvider(key)
  const isValid = provider !== "unknown" && key.length > 20

  function handleSave() {
    if (!isValid) return
    KeyStore.set(key.trim())
    onClose()
  }

  function handleClear() {
    KeyStore.clear()
    setKey("")
  }

  const providerLabels: Record<string, string> = {
    anthropic: "Anthropic Claude ✓",
    openai: "OpenAI GPT ✓",
    gemini: "Google Gemini ✓",
    unknown: "Cole uma key válida",
  }

  return (
    <div className="byok-modal">
      <h2>Sua API Key (BYOK)</h2>
      <p>
        A key fica salva apenas nesta sessão do browser. Nunca é enviada ao servidor.
        Aceita Anthropic, OpenAI ou Gemini.
      </p>
      <input
        type="password"
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="sk-ant-... ou sk-... ou AIza..."
        autoComplete="off"
      />
      <span className={`provider-badge ${provider}`}>
        {providerLabels[provider]}
      </span>
      <div className="byok-actions">
        <button onClick={handleClear} className="secondary">Limpar</button>
        <button onClick={handleSave} disabled={!isValid}>Salvar</button>
      </div>
    </div>
  )
}
```
