import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"

const API_URL = "https://api.openai.com/v1/responses"

export class OpenAIAdapter implements LLMAdapter {
  readonly provider: Provider = "openai"
  constructor(private key: string, public model: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.key}`,
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "public_url",
      preferredApi: "responses",
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
    const userContent = [
      {
        type: "input_text",
        text: useSystemRole ? prepared.userPrompt : prepared.combinedPrompt,
      },
      ...(prepared.image ? [toOpenAIImageInput(prepared.image)] : []),
    ]

    const input = useSystemRole
      ? [
          {
            role: "system",
            content: [{ type: "input_text", text: prepared.systemPrompt }],
          },
          { role: "user", content: userContent },
        ]
      : [{ role: "user", content: userContent }]

    const res = await fetch(API_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 600,
        input,
        stream,
      }),
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(err)}`)
    }

    if (stream && onChunk) {
      const text = await this.consumeOpenAIStream(res, onChunk, signal)
      return { text, inputMode: prepared.inputMode }
    }

    const data = (await res.json()) as OpenAIResponse
    return {
      text: extractOpenAIText(data),
      inputMode: prepared.inputMode,
    }
  }

  /**
   * OpenAI SSE format:
   * data: {"choices":[{"delta":{"content":"..."}}]}
   * Terminal: data: [DONE]
   */
  private async consumeOpenAIStream(
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
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            accumulated += parsed.delta
            onChunk(parsed.delta)
          } else if (
            parsed.type === "response.output_text.done" &&
            typeof parsed.text === "string" &&
            accumulated.length === 0
          ) {
            accumulated = parsed.text
            onChunk(parsed.text)
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

function toOpenAIImageInput(image: Awaited<ReturnType<typeof prepareSynthesisInput>>["image"]) {
  if (!image) return null

  return {
    type: "input_image",
    image_url:
      image.transport === "public_url"
        ? image.url
        : `data:${image.mimeType};base64,${image.data}`,
    detail: image.detail,
  }
}

function extractOpenAIText(data: OpenAIResponse): string {
  if (typeof data.output_text === "string") return data.output_text

  const chunks = data.output
    ?.flatMap((item) => item.content ?? [])
    .flatMap((content) => (content.type === "output_text" && typeof content.text === "string" ? [content.text] : []))

  return chunks?.join("") ?? ""
}

interface OpenAIResponse {
  output_text?: string
  output?: {
    content?: {
      type?: string
      text?: string
    }[]
  }[]
}

function isSystemRoleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
