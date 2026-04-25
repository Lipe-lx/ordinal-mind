import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

export class GeminiAdapter implements LLMAdapter {
  readonly provider: Provider = "gemini"
  constructor(private key: string, public model: string) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsVisionInput: true,
      supportsToolCalling: true,
      imageTransport: "inline_data",
      preferredApi: "generateContent",
    }
  }

  async synthesize(chronicle: Chronicle): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, false, true)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported, falling back to combined prompt")
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
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported in stream mode, falling back")
        return await this.request(chronicle, true, false, onChunk, signal)
      }
      throw err
    }
  }

  private async request(
    chronicle: Chronicle,
    stream: boolean,
    useSystemInstruction: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities())
    const action = stream ? "streamGenerateContent" : "generateContent"
    const streamParam = stream ? "&alt=sse" : ""
    const url = `${BASE_URL}/${this.model}:${action}?key=${this.key}${streamParam}`

    // Build request body
    const body: Record<string, unknown> = {
      contents: [
        {
          parts: buildGeminiParts(
            useSystemInstruction ? prepared.userPrompt : prepared.combinedPrompt,
            prepared.image
          ),
        },
      ],
      generationConfig: { maxOutputTokens: 600 },
    }

    // Add systemInstruction when supported
    if (useSystemInstruction) {
      body.system_instruction = {
        parts: [{ text: prepared.systemPrompt }],
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const errorMsg = JSON.stringify(err)
      // Detect systemInstruction errors for fallback
      if (useSystemInstruction && errorMsg.toLowerCase().includes("system_instruction")) {
        throw new SystemInstructionError(
          `Gemini error ${res.status}: ${errorMsg}`
        )
      }
      throw new Error(`Gemini error ${res.status}: ${errorMsg}`)
    }

    if (stream && onChunk) {
      const text = await this.consumeGeminiStream(res, onChunk, signal)
      return { text, inputMode: prepared.inputMode }
    }

    const data = (await res.json()) as GeminiResponse
    return {
      text: extractGeminiText(data),
      inputMode: prepared.inputMode,
    }
  }

  /**
   * Gemini SSE format (alt=sse):
   * data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
   *
   * Quirks:
   * - Thinking models may send empty text in early chunks
   * - Some chunks may have finishReason without text
   */
  private async consumeGeminiStream(
    res: Response,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    let accumulated = ""

    await consumeSSE(
      res,
      (data) => {
        try {
          const parsed = JSON.parse(data) as GeminiResponse
          
          const candidate = parsed.candidates?.[0]
          if (!candidate?.content?.parts) return

          // Extract text from ALL parts (some models split across multiple parts)
          for (const part of candidate.content.parts) {
            if (part.text) {
              accumulated += part.text
              onChunk(part.text)
            }
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

function buildGeminiParts(text: string, image?: PreparedImageInput) {
  return [
    { text },
    ...(image ? [toGeminiImagePart(image)] : []),
  ]
}

function toGeminiImagePart(image: PreparedImageInput) {
  if (image.transport === "inline_data") {
    return {
      inline_data: {
        mime_type: image.mimeType,
        data: image.data,
      },
    }
  }

  return {
    file_data: {
      mime_type: "text/plain",
      file_uri: image.url,
    },
  }
}

function extractGeminiText(data: GeminiResponse): string {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  )
}


// --- Gemini-specific types ---

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[]
    }
    finishReason?: string
  }[]
}

class SystemInstructionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SystemInstructionError"
  }
}

function isSystemInstructionError(err: unknown): boolean {
  if (err instanceof SystemInstructionError) return true
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes("system_instruction") ||
    msg.includes("systeminstructio") ||
    (msg.includes("system") && msg.includes("not supported"))
  )
}
