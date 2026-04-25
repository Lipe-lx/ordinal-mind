import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildSystemPrompt, buildUserPrompt, buildCombinedPrompt } from "./prompt"
import { consumeSSE } from "./streamParser"

const API_URL = "https://openrouter.ai/api/v1/chat/completions"

export class OpenRouterAdapter implements LLMAdapter {
  readonly provider: Provider = "openrouter"
  constructor(private key: string, public model: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.key}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinal-mind.com",
      "X-Title": "Ordinal Mind",
    }
  }

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    try {
      return await this.request(meta, events, false, true)
    } catch (err) {
      if (isSystemRoleError(err)) {
        return await this.request(meta, events, false, false)
      }
      throw err
    }
  }

  async synthesizeStream(
    meta: InscriptionMeta,
    events: ChronicleEvent[],
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    try {
      return await this.request(meta, events, true, true, onChunk, signal)
    } catch (err) {
      if (isSystemRoleError(err)) {
        return await this.request(meta, events, true, false, onChunk, signal)
      }
      throw err
    }
  }

  private async request(
    meta: InscriptionMeta,
    events: ChronicleEvent[],
    stream: boolean,
    useSystemRole: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const messages = useSystemRole
      ? [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(meta, events) },
        ]
      : [{ role: "user", content: buildCombinedPrompt(meta, events) }]
    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: 600,
        messages,
        stream,
      }),
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(err)}`)
    }

    if (stream && onChunk) {
      return this.consumeOpenRouterStream(res, onChunk, signal)
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ""
  }

  /**
   * OpenRouter SSE format (OpenAI-compatible):
   * data: {"choices":[{"delta":{"content":"..."}}]}
   * Terminal: data: [DONE]
   *
   * Quirks:
   * - May contain `: OPENROUTER PROCESSING` comment lines (handled by streamParser)
   * - Reasoning models may include `reasoning_content` field — we ignore it
   * - Errors mid-stream arrive as JSON with `error` field
   */
  private async consumeOpenRouterStream(
    res: Response,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    let accumulated = ""

    await consumeSSE(
      res,
      (data) => {
        try {
          const parsed = JSON.parse(data)

          // Check for mid-stream errors
          if (parsed.error) {
            console.error("[OpenRouter] mid-stream error:", parsed.error)
            return
          }

          // Extract content delta (ignore reasoning_content)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            accumulated += content
            onChunk(content)
          }
        } catch {
          // Skip unparseable chunks
        }
      },
      signal
    )

    return accumulated
  }
}

function isSystemRoleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
