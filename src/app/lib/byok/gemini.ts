import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"
import type { ToolExecutor } from "./toolExecutor"

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

  async synthesize(chronicle: Chronicle, toolExecutor?: ToolExecutor): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, false, true, undefined, undefined, toolExecutor)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported, falling back to combined prompt")
        return await this.request(chronicle, false, false, undefined, undefined, toolExecutor)
      }
      throw err
    }
  }

  async synthesizeStream(
    chronicle: Chronicle,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, true, true, onChunk, signal, toolExecutor)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported in stream mode, falling back")
        return await this.request(chronicle, true, false, onChunk, signal, toolExecutor)
      }
      throw err
    }
  }

  private async request(
    chronicle: Chronicle,
    stream: boolean,
    useSystemInstruction: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys())
    const action = stream ? "streamGenerateContent" : "generateContent"
    const streamParam = stream ? "&alt=sse" : ""
    const url = `${BASE_URL}/${this.model}:${action}?key=${this.key}${streamParam}`

    const tools = prepared.searchToolsEnabled ? [{
      function_declarations: prepared.availableTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }] : undefined

    const contents: Array<{
      role: string;
      parts: Array<{
        text?: string;
        inline_data?: { mime_type: string; data: string };
        file_data?: { mime_type: string; file_uri: string };
        functionCall?: { name: string; args: Record<string, unknown> };
        functionResponse?: { name: string; response: unknown };
      }>;
    }> = [
      {
        role: "user",
        parts: buildGeminiParts(
          useSystemInstruction ? prepared.userPrompt : prepared.combinedPrompt,
          prepared.image
        ),
      },
    ]

    const inputMode = prepared.inputMode

    for (let i = 0; i < 7; i++) {
      // Build request body
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { maxOutputTokens: 600 },
      }

      if (tools && tools.length > 0) {
        body.tools = tools
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

      if (stream) {
        const streamResult = await this.consumeGeminiStreamWithTools(res, onChunk, signal)
        if (streamResult.toolCalls.length > 0 && toolExecutor) {
          contents.push({
             role: "model",
             parts: streamResult.toolCalls.map(c => ({ functionCall: { name: c.name, args: c.args } }))
          })
          
          const functionResponses = []
          for (const call of streamResult.toolCalls) {
            const result = await toolExecutor.executeTool(call.name, call.args)
            functionResponses.push({
               functionResponse: { name: call.name, response: result }
            })
          }
          contents.push({ role: "user", parts: functionResponses }) // sometimes user, sometimes function
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as GeminiResponse
        const candidate = data.candidates?.[0]
        const parts = candidate?.content?.parts || []
        
        const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!)
        
        if (functionCalls.length > 0 && toolExecutor) {
          contents.push({
             role: "model",
             parts: functionCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))
          })
          
          const functionResponses = []
          for (const call of functionCalls) {
            const result = await toolExecutor.executeTool(call.name, call.args)
            functionResponses.push({
               functionResponse: { name: call.name, response: result }
            })
          }
          contents.push({ role: "user", parts: functionResponses })
          continue
        }

        return { text: extractGeminiText(data), inputMode }
      }
    }

    return { text: "Tool calling limit reached.", inputMode }
  }

  private async consumeGeminiStreamWithTools(
    res: Response,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string, toolCalls: Array<{name: string, args: Record<string, unknown>}> }> {
    let accumulatedText = ""
    const toolCalls: Array<{name: string, args: Record<string, unknown>}> = []

    await consumeSSE(
      res,
      (data) => {
        try {
          const parsed = JSON.parse(data) as GeminiResponse
          
          const candidate = parsed.candidates?.[0]
          if (!candidate?.content?.parts) return

          for (const part of candidate.content.parts) {
            if (part.text) {
              accumulatedText += part.text
              if (onChunk) onChunk(part.text)
            }
            if (part.functionCall) {
              toolCalls.push({ name: part.functionCall.name, args: part.functionCall.args })
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      },
      signal
    )

    return { text: accumulatedText, toolCalls }
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
        mime_type: image.mimeType || "image/png",
        data: image.data || "",
      },
    }
  }

  return {
    file_data: {
      mime_type: "text/plain",
      file_uri: image.url || "",
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
      parts?: { 
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
      }[]
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
