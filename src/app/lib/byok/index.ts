// BYOK provider detection and key management.
// The key stays in sessionStorage — never sent to the server.

import type { Chronicle } from "../types"
import type { ProviderCapabilities, SynthesisMode } from "./context"
import { AnthropicAdapter } from "./anthropic"
import { OpenAIAdapter } from "./openai"
import { GeminiAdapter } from "./gemini"
import { OpenRouterAdapter } from "./openrouter"

export type Provider = "anthropic" | "openai" | "gemini" | "openrouter" | "unknown"

export interface ByokConfig {
  provider: Provider
  model: string
  key: string
}

export interface SynthesisResult {
  text: string
  inputMode: SynthesisMode
}

export interface LLMAdapter {
  synthesize(chronicle: Chronicle): Promise<SynthesisResult>
  synthesizeStream(
    chronicle: Chronicle,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult>
  getCapabilities(): ProviderCapabilities
  provider: Provider
  model: string
}

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Google Gemini" },
  { id: "openrouter", name: "OpenRouter" }
] as const

export const MODELS: Record<string, { id: string, name: string }[]> = {
  anthropic: [
    { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-latest", name: "Claude 3 Opus" }
  ],
  openai: [
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "o3-mini", name: "o3-mini" },
    { id: "o1", name: "o1" }
  ],
  gemini: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-2.5-flash-001", name: "Gemini 2.5 Flash" },
    { id: "gemma-4-31b-it", name: "Gemma 4 (31B)" },
    { id: "gemma-4-26b-a4b-it", name: "Gemma 4 (26B A4B)" }
  ],
  openrouter: [
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "xiaomi/mimo-v2-pro", name: "MiMo V2 Pro" }
  ]
}

export function detectProvider(key: string): Provider {
  if (key.startsWith("sk-or-")) return "openrouter"
  if (key.startsWith("sk-ant-")) return "anthropic"
  if (key.startsWith("sk-")) return "openai"
  if (key.startsWith("AIza")) return "gemini"
  return "unknown"
}

export function createAdapter(config: ByokConfig): LLMAdapter | null {
  if (!config.key || config.provider === "unknown") return null

  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.key, config.model)
    case "openai":
      return new OpenAIAdapter(config.key, config.model)
    case "gemini":
      return new GeminiAdapter(config.key, config.model)
    case "openrouter":
      return new OpenRouterAdapter(config.key, config.model)
    default:
      return null
  }
}

// Key management via sessionStorage (never persists beyond session)
const STORAGE_KEY = "ordinal-mind_byok_config"

export const KeyStore = {
  get: (): ByokConfig | null => {
    try {
      const data = sessionStorage.getItem(STORAGE_KEY)
      if (!data) return null
      return JSON.parse(data) as ByokConfig
    } catch {
      return null
    }
  },
  set: (config: ByokConfig) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch { /* noop */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
  },
  has: (): boolean => {
    try {
      const data = sessionStorage.getItem(STORAGE_KEY)
      if (!data) return false
      const parsed = JSON.parse(data)
      return !!parsed.key && parsed.provider !== "unknown"
    } catch {
      return false
    }
  },
}
