import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
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

  getCapabilities(): ProviderCapabilities {
    return {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "messages",
    }
  }

  async synthesize(chronicle: Chronicle): Promise<SynthesisResult> {
    try {
      return await this.requestWithSystemMessage(chronicle, false)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, false)
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
      return await this.requestWithSystemMessage(chronicle, true, onChunk, signal)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, true, onChunk, signal)
      }
      throw err
    }
  }

  private async requestWithSystemMessage(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities())
    const body = {
      model: this.model,
      max_tokens: 600,
      system: prepared.systemPrompt,
      messages: [{ role: "user", content: buildAnthropicContent(prepared.userPrompt, prepared.image) }],
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
      const text = await this.consumeAnthropicStream(res, onChunk, signal)
      return { text, inputMode: prepared.inputMode }
    }

    const data = (await res.json()) as { content?: { text?: string }[] }
    return {
      text: data.content?.[0]?.text ?? "",
      inputMode: prepared.inputMode,
    }
  }

  private async requestCombined(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities())
    const body = {
      model: this.model,
      max_tokens: 600,
      messages: [{ role: "user", content: buildAnthropicContent(prepared.combinedPrompt, prepared.image) }],
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
      const text = await this.consumeAnthropicStream(res, onChunk, signal)
      return { text, inputMode: prepared.inputMode }
    }

    const data = (await res.json()) as { content?: { text?: string }[] }
    return {
      text: data.content?.[0]?.text ?? "",
      inputMode: prepared.inputMode,
    }
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

function buildAnthropicContent(text: string, image?: PreparedImageInput) {
  return [
    { type: "text", text },
    ...(image ? [toAnthropicImageBlock(image)] : []),
  ]
}

function toAnthropicImageBlock(image: PreparedImageInput) {
  if (image.transport === "public_url") {
    return {
      type: "image",
      source: {
        type: "url",
        url: image.url,
      },
    }
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mimeType,
      data: image.data,
    },
  }
}

function isSystemMessageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
