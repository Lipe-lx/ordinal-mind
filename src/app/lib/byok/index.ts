// BYOK provider detection and key management.
// The key stays in sessionStorage — never sent to the server.

import type { Chronicle } from "../types"
import type { ProviderCapabilities, SynthesisMode } from "./context"
import { AnthropicAdapter } from "./anthropic"
import { OpenAIAdapter } from "./openai"
import { GeminiAdapter } from "./gemini"
import { OpenRouterAdapter } from "./openrouter"
import type { ResearchKeys, ToolExecutor } from "./toolExecutor"
import type { ChatMessage } from "./chatTypes"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { ChatToolPolicyDecision } from "./toolPolicy"

export type Provider = "anthropic" | "openai" | "gemini" | "openrouter" | "unknown"

export interface ByokConfig {
  provider: Provider
  model: string
  key: string
  researchKeys?: ResearchKeys
}

export interface SynthesisResult {
  text: string
  inputMode: SynthesisMode
}

export interface LLMAdapter {
  synthesize(chronicle: Chronicle, toolExecutor?: ToolExecutor): Promise<SynthesisResult>
  synthesizeStream(
    chronicle: Chronicle,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult>
  chatStream(params: {
    chronicle: Chronicle
    history: ChatMessage[]
    userMessage: string
    mode: ChatResponseMode
    intent: ChatIntent
    toolPolicyDecision?: ChatToolPolicyDecision
    wikiCompletenessInfo?: string
    wikiPage?: import("../wikiTypes").WikiPage | null
    wikiStatus?: string
    onChunk: (text: string) => void
    signal?: AbortSignal
    toolExecutor?: ToolExecutor
  }): Promise<SynthesisResult>
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
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
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

// ---------------------------------------------------------------------------
// Key management — dual-mode storage
//
// Anon users (no Discord):  sessionStorage  — ephemeral, closes with tab
// Discord users:            localStorage    — persistent, AES-256-GCM encrypted
//
// The switch happens via promoteToLocalStorage() / demoteToSessionStorage().
// ---------------------------------------------------------------------------

const SESSION_KEY = "ordinal-mind_byok_config"
const LOCAL_ENCRYPTED_KEY = "ordinal-mind_byok_encrypted"
const DISCORD_JWT_KEY = "ordinal-mind_discord_jwt"

function hasDiscordJWT(): boolean {
  try {
    const token = localStorage.getItem(DISCORD_JWT_KEY)
    if (!token) return false
    // Quick expiry check without crypto (parse payload middle segment)
    const parts = token.split(".")
    if (parts.length !== 3) return false
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }
    const now = Math.floor(Date.now() / 1000)
    return typeof payload.exp === "number" && payload.exp > now
  } catch {
    return false
  }
}

export const KeyStore = {
  /** Get config — checks encrypted localStorage first (Discord), then sessionStorage (anon). */
  get: (): ByokConfig | null => {
    // Discord path: read encrypted from localStorage
    if (hasDiscordJWT()) {
      try {
        const raw = localStorage.getItem(LOCAL_ENCRYPTED_KEY)
        if (raw) {
          // Return cached plaintext from sessionStorage (set during decrypt in promoteToLocalStorage)
          // This avoids async decryption on every get() call.
          const session = sessionStorage.getItem(SESSION_KEY)
          if (session) return JSON.parse(session) as ByokConfig
        }
      } catch { /* fall through */ }
    }
    // Anon path: sessionStorage
    try {
      const data = sessionStorage.getItem(SESSION_KEY)
      if (!data) return null
      return JSON.parse(data) as ByokConfig
    } catch {
      return null
    }
  },

  /** Set config — always writes to sessionStorage for fast sync reads.
   *  If Discord is connected, also writes encrypted copy to localStorage. */
  set: (config: ByokConfig): void => {
    // Always update sessionStorage (used as plaintext cache for sync get())
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(config))
    } catch { /* noop */ }

    // If Discord connected, asynchronously update encrypted localStorage copy
    if (hasDiscordJWT()) {
      import("../keyEncryption").then(({ encryptValue }) => {
        return encryptValue(config).then((payload) => {
          localStorage.setItem(LOCAL_ENCRYPTED_KEY, JSON.stringify(payload))
        })
      }).catch(() => { /* non-blocking */ })
    }
  },

  /** Clear all stored configs from both storages. */
  clear: (): void => {
    try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
    try { localStorage.removeItem(LOCAL_ENCRYPTED_KEY) } catch { /* noop */ }
  },

  /** Returns true if a valid config with a key exists. */
  has: (): boolean => {
    try {
      const data = sessionStorage.getItem(SESSION_KEY)
      if (!data) return false
      const parsed = JSON.parse(data)
      return !!parsed.key && parsed.provider !== "unknown"
    } catch {
      return false
    }
  },

  /**
   * Called when Discord connects.
   * Reads current config from sessionStorage, encrypts it, and writes to localStorage.
   * Also populates sessionStorage cache for sync reads.
   */
  promoteToLocalStorage: async (): Promise<void> => {
    const { encryptValue } = await import("../keyEncryption")
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return // no config to promote
      const config = JSON.parse(raw) as ByokConfig
      const payload = await encryptValue(config)
      localStorage.setItem(LOCAL_ENCRYPTED_KEY, JSON.stringify(payload))
      // sessionStorage remains as plaintext cache — no change needed
    } catch {
      // Non-blocking: worst case, config stays only in sessionStorage this session
    }
  },

  /**
   * Called when Discord disconnects.
   * Decrypts config from localStorage (if present) back to sessionStorage, then clears localStorage.
   * Ensures user doesn't lose their LLM key on disconnect.
   */
  demoteToSessionStorage: async (): Promise<void> => {
    const { decryptValue } = await import("../keyEncryption")
    try {
      const raw = localStorage.getItem(LOCAL_ENCRYPTED_KEY)
      if (raw) {
        const payload = JSON.parse(raw) as { ct: string; iv: string }
        const config = await decryptValue<ByokConfig>(payload)
        if (config) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(config))
        }
        localStorage.removeItem(LOCAL_ENCRYPTED_KEY)
      }
    } catch {
      // Non-blocking: worst case, user needs to re-enter key
    }
  },
}
