import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"
import type { ToolExecutor } from "./toolExecutor"
import type { ChatMessage } from "./chatTypes"
import { buildChatTurnPrompt, INITIAL_NARRATIVE_PROMPT } from "./prompt"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { ChatToolPolicyDecision } from "./toolPolicy"

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
    if (isGemmaModel(this.model)) {
      return await this.request(chronicle, false, false, undefined, undefined, toolExecutor, undefined, true)
    }

    try {
      return await this.request(chronicle, false, true, undefined, undefined, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported, falling back to combined prompt")
        return await this.request(chronicle, false, false, undefined, undefined, toolExecutor, undefined, true)
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
    if (isGemmaModel(this.model)) {
      return await this.request(chronicle, true, false, onChunk, signal, toolExecutor, undefined, true)
    }

    try {
      return await this.request(chronicle, true, true, onChunk, signal, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported in stream mode, falling back")
        return await this.request(chronicle, true, false, onChunk, signal, toolExecutor, undefined, true)
      }
      throw err
    }
  }

  async chatStream({
    chronicle,
    history,
    userMessage,
    mode,
    intent,
    toolPolicyDecision,
    onChunk,
    signal,
    toolExecutor,
  }: {
    chronicle: Chronicle
    history: ChatMessage[]
    userMessage: string
    mode: ChatResponseMode
    intent: ChatIntent
    toolPolicyDecision?: ChatToolPolicyDecision
    onChunk: (text: string) => void
    signal?: AbortSignal
    toolExecutor?: ToolExecutor
  }): Promise<SynthesisResult> {
    const conversationPrompt = buildChatTurnPrompt(
      chronicle,
      history,
      userMessage || INITIAL_NARRATIVE_PROMPT,
      { mode, intent }
    )
    const enableVision = history.length === 0

    if (isGemmaModel(this.model)) {
      return await this.request(
        chronicle,
        true,
        false,
        onChunk,
        signal,
        toolExecutor,
        conversationPrompt,
        enableVision,
        toolPolicyDecision
      )
    }

    try {
      return await this.request(
        chronicle,
        true,
        true,
        onChunk,
        signal,
        toolExecutor,
        conversationPrompt,
        enableVision,
        toolPolicyDecision
      )
    } catch (err) {
      if (isSystemInstructionError(err)) {
        console.warn("[GeminiAdapter] systemInstruction not supported in chat mode, falling back")
        return await this.request(
          chronicle,
          true,
          false,
          onChunk,
          signal,
          toolExecutor,
          conversationPrompt,
          enableVision,
          toolPolicyDecision
        )
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
    toolExecutor?: ToolExecutor,
    promptOverride?: string,
    allowVisionInput = true,
    toolPolicyDecision?: ChatToolPolicyDecision
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys(), toolPolicyDecision)
    const userPrompt = promptOverride
      ? (useSystemInstruction ? promptOverride : `${prepared.systemPrompt}\n\n${promptOverride}`)
      : (useSystemInstruction ? prepared.userPrompt : prepared.combinedPrompt)
    const image = allowVisionInput ? prepared.image : undefined
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

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: buildGeminiParts(
          userPrompt,
          image
        ),
      },
    ]

    const inputMode = allowVisionInput ? prepared.inputMode : "text-only"

    for (let i = 0; i < 7; i++) {
      // Build request body
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { maxOutputTokens: 600 },
      }

      if (tools && tools.length > 0) {
        body.tools = tools
        body.tool_config = buildGeminiToolConfig(prepared.availableTools, toolPolicyDecision)
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
          contents.push(streamResult.modelContent)

          const functionResponses: GeminiPart[] = []
          for (const call of streamResult.toolCalls) {
            // Validate tool exists before executing
            const toolExists = prepared.availableTools.some(t => t.name === call.name)
            if (!toolExists) {
              console.warn(`[GeminiAdapter] Ignoring unknown tool call: ${call.name}`)
              continue
            }
            const result = await toolExecutor.executeTool(call.name, call.args)
            functionResponses.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: result,
              },
            })
          }
          contents.push({ role: "user", parts: functionResponses })
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as GeminiResponse
        const candidate = data.candidates?.[0]
        const modelContent = candidate?.content
        const parts = modelContent?.parts || []
        const functionCalls = parts
          .filter((part): part is GeminiPart & { functionCall: GeminiFunctionCall } => Boolean(part.functionCall))
          .map((part) => part.functionCall)

        if (functionCalls.length > 0 && toolExecutor) {
          contents.push(modelContent ?? { role: "model", parts })

          const functionResponses: GeminiPart[] = []
          for (const call of functionCalls) {
            // Validate tool exists before executing
            const toolExists = prepared.availableTools.some(t => t.name === call.name)
            if (!toolExists) {
              console.warn(`[GeminiAdapter] Ignoring unknown tool call: ${call.name}`)
              continue
            }
            const result = await toolExecutor.executeTool(call.name, call.args)
            functionResponses.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: result,
              },
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
  ): Promise<{ text: string, toolCalls: GeminiFunctionCall[], modelContent: GeminiContent }> {
    let accumulatedText = ""
    const toolCalls: GeminiFunctionCall[] = []
    const seenCalls = new Set<string>()
    const modelParts: GeminiPart[] = []

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
              modelParts.push({ text: part.text, thoughtSignature: part.thoughtSignature })
            }
            if (part.functionCall) {
              const callKey = part.functionCall.id ?? `${part.functionCall.name}:${JSON.stringify(part.functionCall.args)}:${toolCalls.length}`
              if (!seenCalls.has(callKey)) {
                seenCalls.add(callKey)
                toolCalls.push(part.functionCall)
                modelParts.push({ functionCall: part.functionCall, thoughtSignature: part.thoughtSignature })
              }
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      },
      signal
    )

    return {
      text: accumulatedText,
      toolCalls,
      modelContent: {
        role: "model",
        parts: modelParts,
      },
    }
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

function buildGeminiToolConfig(
  tools: Array<{ name: string }>,
  toolPolicyDecision?: ChatToolPolicyDecision
): Record<string, unknown> | undefined {
  if (!toolPolicyDecision) return undefined
  if (toolPolicyDecision.geminiMode === "NONE") {
    return {
      function_calling_config: {
        mode: "NONE",
      },
    }
  }

  if (toolPolicyDecision.geminiMode === "ANY") {
    const allowed = toolPolicyDecision.allowedToolNames.filter((name) => tools.some((tool) => tool.name === name))
    return {
      function_calling_config: {
        mode: "ANY",
        ...(allowed.length > 0 ? { allowed_function_names: allowed } : {}),
      },
    }
  }

  return {
    function_calling_config: {
      mode: "AUTO",
    },
  }
}

function isGemmaModel(model: string): boolean {
  return /^gemma[-_]/i.test(model)
}


// --- Gemini-specific types ---

interface GeminiFunctionCall {
  id?: string
  name: string
  args: Record<string, unknown>
  thoughtSignature?: string
}

interface GeminiFunctionResponse {
  id?: string
  name: string
  response: unknown
}

interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
  file_data?: { mime_type: string; file_uri: string }
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
  thoughtSignature?: string
}

interface GeminiContent {
  role: string
  parts: GeminiPart[]
}

interface GeminiResponse {
  candidates?: {
    content?: GeminiContent
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
