import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
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

  getCapabilities(): ProviderCapabilities {
    return {
      supportsVisionInput: true,
      supportsToolCalling: false,
      imageTransport: "public_url",
      preferredApi: "chat_completions",
    }
  }

  async synthesize(chronicle: Chronicle): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, false, true)
    } catch (err) {
      if (isSystemRoleError(err)) {
        return await this.request(chronicle, false, false)
      }
      throw err
    }
  }

  async synthesizeStream(
    chronicle: Chronicle,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, true, true, onChunk, signal)
    } catch (err) {
      if (isSystemRoleError(err)) {
        return await this.request(chronicle, true, false, onChunk, signal)
      }
      throw err
    }
  }

  private async request(
    chronicle: Chronicle,
    stream: boolean,
    useSystemRole: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities())
    const messages = useSystemRole
      ? [
          { role: "system", content: prepared.systemPrompt },
          {
            role: "user",
            content: buildOpenRouterContent(prepared.userPrompt, prepared.image),
          },
        ]
      : [
          {
            role: "user",
            content: buildOpenRouterContent(prepared.combinedPrompt, prepared.image),
          },
        ]
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
      const text = await this.consumeOpenRouterStream(res, onChunk, signal)
      return { text, inputMode: prepared.inputMode }
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      inputMode: prepared.inputMode,
    }
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

function buildOpenRouterContent(text: string, image?: PreparedImageInput) {
  if (!image) return text

  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url:
          image.transport === "public_url"
            ? image.url
            : `data:${image.mimeType};base64,${image.data}`,
      },
    },
  ]
}

function isSystemRoleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
