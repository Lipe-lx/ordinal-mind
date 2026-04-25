import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildSystemPrompt, buildUserPrompt, buildCombinedPrompt } from "./prompt"
import { consumeSSE } from "./streamParser"

const API_URL = "https://api.anthropic.com/v1/messages"

export class AnthropicAdapter implements LLMAdapter {
  readonly provider: Provider = "anthropic"
  constructor(private key: string, public model: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }
  }

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    try {
      return await this.requestWithSystemMessage(meta, events, false)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(meta, events, false)
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
      return await this.requestWithSystemMessage(meta, events, true, onChunk, signal)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(meta, events, true, onChunk, signal)
      }
      throw err
    }
  }

  private async requestWithSystemMessage(
    meta: InscriptionMeta,
    events: ChronicleEvent[],
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: 600,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(meta, events) }],
      stream,
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(err)}`)
    }

    if (stream && onChunk) {
      return this.consumeAnthropicStream(res, onChunk, signal)
    }

    const data = (await res.json()) as { content?: { text?: string }[] }
    return data.content?.[0]?.text ?? ""
  }

  private async requestCombined(
    meta: InscriptionMeta,
    events: ChronicleEvent[],
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: 600,
      messages: [{ role: "user", content: buildCombinedPrompt(meta, events) }],
      stream,
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(err)}`)
    }

    if (stream && onChunk) {
      return this.consumeAnthropicStream(res, onChunk, signal)
    }

    const data = (await res.json()) as { content?: { text?: string }[] }
    return data.content?.[0]?.text ?? ""
  }

  /**
   * Anthropic SSE format:
   * event: content_block_delta
   * data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
   *
   * Terminal: event: message_stop
   */
  private async consumeAnthropicStream(
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
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            accumulated += parsed.delta.text
            onChunk(parsed.delta.text)
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

function isSystemMessageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
