# BYOK — Provider-Agnostic Chronicle Synthesizer

The Chronicle Synthesizer runs **entirely in the browser** using the user's provided API keys. The Worker never sees or stores these keys. Keys are managed via `sessionStorage` in a `ByokConfig` object.

---

## Provider Detection & Configuration

```typescript
// src/app/lib/byok/index.ts
export type Provider = "anthropic" | "openai" | "gemini" | "openrouter" | "unknown"

export interface ByokConfig {
  provider: Provider
  model: string
  key: string
  researchKeys?: ResearchKeys
}

export function detectProvider(key: string): Provider {
  if (key.startsWith("sk-or-")) return "openrouter"
  if (key.startsWith("sk-ant-")) return "anthropic"
  if (key.startsWith("sk-")) return "openai"
  if (key.startsWith("AIza")) return "gemini"
  return "unknown"
}
```

---

## Synthesis Architecture

The synthesizer supports both single-shot and streaming modes, with optional tool execution for web research.

```typescript
// src/app/lib/byok/index.ts
export interface LLMAdapter {
  synthesize(chronicle: Chronicle, toolExecutor?: ToolExecutor): Promise<SynthesisResult>
  synthesizeStream(
    chronicle: Chronicle,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult>
  provider: Provider
  model: string
}
```

### Adapters

- **Anthropic**: Supports Claude 3.5/3.7 models with native tool use.
- **OpenAI**: Supports GPT-4o and o1/o3 models.
- **Gemini**: Supports Gemini 2.0/2.5 Flash and Pro models.
- **OpenRouter**: Acts as a gateway to multiple providers (DeepSeek, Llama, etc.).

---

## Prompt Engineering (src/app/lib/byok/prompt.ts)

The system is split into a **System Prompt** (role, constraints, rules) and a **User Prompt** (structured inscription data).

```typescript
export function buildSystemPrompt(availableTools: SearchToolDefinition[] = []): string {
  return `You are a factual chronicler of digital Bitcoin artifacts...
  Rules:
  - Vivid, objective tone.
  - Maximum 5 short paragraphs.
  - No invention of data.
  ...`
}

export function buildUserPrompt(chronicle: Chronicle): string {
  // Serializes the entire Chronicle (meta, events, collection context, research) 
  // into a structured prompt for the LLM.
}
```

---

## Tool Execution (src/app/lib/byok/toolExecutor.ts)

If research keys are provided, the LLM can call tools to gather additional context about collections before writing the Chronicle.

```typescript
export interface ToolExecutor {
  execute(name: string, args: any): Promise<any>
}

// Tools include:
// - brave_search: Deep web search for collection history.
// - exa_search: Neural search for high-quality web results.
// - perplexity: Answer engine for collection milestones.
```

---

## Key Management (KeyStore)

Config is stored as a JSON string in `sessionStorage["ordinal-mind_byok_config"]`. It is cleared when the tab is closed.
