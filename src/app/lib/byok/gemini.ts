import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildSystemPrompt, buildUserPrompt, buildCombinedPrompt } from "./prompt"
import { consumeSSE } from "./streamParser"

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

export class GeminiAdapter implements LLMAdapter {
  readonly provider: Provider = "gemini"
  constructor(private key: string, public model: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    try {
      return await this.request(meta, events, false, true)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported, falling back to combined prompt")
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
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported in stream mode, falling back")
        return await this.request(meta, events, true, false, onChunk, signal)
      }
      throw err
    }
  }

  private async request(
    meta: InscriptionMeta,
    events: ChronicleEvent[],
    stream: boolean,
    useSystemInstruction: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const action = stream ? "streamGenerateContent" : "generateContent"
    const streamParam = stream ? "&alt=sse" : ""
    const url = `${BASE_URL}/${this.model}:${action}?key=${this.key}${streamParam}`

    // Build request body
    const body: Record<string, unknown> = {
      contents: [
        {
          parts: [
            {
              text: useSystemInstruction
                ? buildUserPrompt(meta, events)
                : buildCombinedPrompt(meta, events),
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 600 },
    }

    // Add systemInstruction when supported
    if (useSystemInstruction) {
      body.system_instruction = {
        parts: [{ text: buildSystemPrompt() }],
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
      return this.consumeGeminiStream(res, onChunk, signal)
    }

    const data = (await res.json()) as GeminiResponse
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
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
