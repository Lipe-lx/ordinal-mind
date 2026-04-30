import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedAttachmentInput, ProviderCapabilities, SynthesisMode } from "./context"
import type { SynthesisResult } from "./index"
import {
  prepareSynthesisInput,
  renderTextAttachmentBlock,
  shouldAttachContentForChat,
} from "./context"
import { consumeSSE } from "./streamParser"
import type { ToolExecutor } from "./toolExecutor"
import type { ChatMessage } from "./chatTypes"
import { buildChatTurnPrompt, INITIAL_NARRATIVE_PROMPT } from "./prompt"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { ChatToolPolicyDecision } from "./toolPolicy"
import { fetchGeminiWithRetry } from "./geminiRetry"
import { 
  sanitizeGeminiSchema, 
  sanitizeGeminiTurnOrder, 
  type GeminiContent, 
  type GeminiPart,
  type GeminiFunctionCall,
  cleanResponseText
} from "./ntcUtils"

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
    const enableAttachments = shouldAttachContentForChat({
      chronicle,
      history,
      userMessage: userMessage || INITIAL_NARRATIVE_PROMPT,
      mode,
      intent,
    })

    if (isGemmaModel(this.model)) {
      return await this.request(
        chronicle,
        true,
        false,
        onChunk,
        signal,
        toolExecutor,
        conversationPrompt,
        enableAttachments,
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
        enableAttachments,
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
          enableAttachments,
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
    allowAttachments = true,
    toolPolicyDecision?: ChatToolPolicyDecision
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys(), toolPolicyDecision)
    const userPrompt = promptOverride
      ? (useSystemInstruction ? promptOverride : `${prepared.systemPrompt}\n\n${promptOverride}`)
      : (useSystemInstruction ? prepared.userPrompt : prepared.combinedPrompt)
    const attachments = allowAttachments ? prepared.attachments : []
    const action = stream ? "streamGenerateContent" : "generateContent"
    const streamParam = stream ? "&alt=sse" : ""
    const url = `${BASE_URL}/${this.model}:${action}?key=${this.key}${streamParam}`

    const tools = prepared.searchToolsEnabled ? [{
      function_declarations: prepared.availableTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeGeminiSchema(t.parameters)
      }))
    }] : undefined

    const contents: GeminiContent[] = [
      {
        role: "user",
        parts: buildGeminiParts(
          userPrompt,
          attachments
        ),
      },
    ]

    const isGemma4 = this.model.toLowerCase().includes("gemma-4")
    const inputMode: SynthesisMode = allowAttachments ? prepared.inputMode : "text-only"
    let lastModelText = ""
    const executedCalls = new Set<string>()

    for (let i = 0; i < 7; i++) {
      const body: Record<string, unknown> = {
        contents: sanitizeGeminiTurnOrder(contents),
        generationConfig: { maxOutputTokens: 14336 },
      }

      if (tools && tools.length > 0) {
        body.tools = tools
        const config = buildGeminiToolConfig(prepared.availableTools, toolPolicyDecision) as GeminiToolConfig
        if (isGemma4 && config?.function_calling_config?.mode === "ANY") {
          config.function_calling_config.mode = "AUTO"
        }
        body.tool_config = config
      }

      if (useSystemInstruction) {
        body.system_instruction = {
          parts: [{ text: prepared.systemPrompt }],
        }
      }

      const res = await fetchGeminiWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }, {
        requestLabel: stream ? "gemini_stream_generate_content" : "gemini_generate_content",
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const errorMsg = JSON.stringify(err)
        if (useSystemInstruction && errorMsg.toLowerCase().includes("system_instruction")) {
          throw new SystemInstructionError(`Gemini error ${res.status}: ${errorMsg}`)
        }
        throw new Error(`Gemini error ${res.status}: ${errorMsg}`)
      }

      let modelTurn: GeminiContent | undefined
      let currentToolCalls: GeminiFunctionCall[]

      if (stream) {
        const streamResult = await this.consumeGeminiStreamWithTools(res, onChunk, signal)
        lastModelText = streamResult.text
        modelTurn = streamResult.modelContent
        currentToolCalls = streamResult.toolCalls
      } else {
        const data = (await res.json()) as GeminiResponse
        const candidate = data.candidates?.[0]
        modelTurn = candidate?.content ?? { role: "model", parts: [] }
        const parts = modelTurn.parts || []
        currentToolCalls = parts
          .filter((part): part is GeminiPart & { functionCall: GeminiFunctionCall } => Boolean(part.functionCall))
          .map((part) => part.functionCall!)
        lastModelText = extractGeminiText(data)
      }

      const hasToolCalls = currentToolCalls.length > 0
      if (!hasToolCalls && (!lastModelText || !lastModelText.trim())) {
        if (i < 2) {
          contents.push({
            role: "user",
            parts: [{ text: "Your previous response was empty. Please answer the user's question or use a tool if needed." }]
          })
          continue
        }
      }

      // Check for leakage in text-only response (non-tool call)
      if (!hasToolCalls && i < 2) {
        const cleaned = cleanResponseText(lastModelText)
        const leaked = lastModelText.toLowerCase().includes("user question:") || lastModelText.toLowerCase().includes("target:")
        const isEmptyAfterCleanup = !cleaned.trim()
        
        if ((leaked || isEmptyAfterCleanup) && !lastModelText.includes("<final_answer>")) {
           contents.push({ role: "model", parts: [{ text: lastModelText }] })
           contents.push({
             role: "user",
             parts: [{ text: "- Put the user-visible Chronicle between these exact tags: <final_answer> and </final_answer>.\n- Keep internal <thought> blocks brief and focused on evidence evaluation.\n- The text inside the final_answer tags must be complete sentences.\n- Use <thought> tags for internal reasoning. Everything outside <final_answer> will be hidden." }]
           })
           continue
        }
      }

      if (hasToolCalls && toolExecutor) {
        contents.push(modelTurn!)

        const functionResponses = await Promise.all(
          currentToolCalls.map(async (call) => {
            const callKey = `${call.name}:${JSON.stringify(call.args)}`
            if (executedCalls.has(callKey)) {
              return {
                functionResponse: {
                  id: call.id,
                  name: call.name,
                  response: { error: "Redundant call detected. Use existing data." },
                },
              }
            }
            executedCalls.add(callKey)

            const toolExists = prepared.availableTools.some(t => t.name === call.name)
            if (!toolExists) {
              return {
                functionResponse: {
                  id: call.id,
                  name: call.name,
                  response: { error: `Unknown tool: ${call.name}` },
                },
              }
            }
            const result = await toolExecutor.executeTool(call.name, call.args)
            return {
              functionResponse: {
                id: call.id,
                name: call.name,
                response: result,
              },
            }
          })
        )
        contents.push({ role: "user", parts: functionResponses })

        // If we still have room, continue searching
        if (i < 6) continue

        // Limit reached: synthesize fallback
        contents.push({
          role: "user",
          parts: [{
            text: "Based on the research conducted, provide your best direct answer to the user's original question."
          }]
        })
        const finalBody = {
          contents: sanitizeGeminiTurnOrder(contents),
          generationConfig: { maxOutputTokens: 2048 },
          ...(useSystemInstruction ? { system_instruction: { parts: [{ text: prepared.systemPrompt }] } } : {})
        }
        const finalRes = await fetchGeminiWithRetry(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalBody),
          signal,
        }, {
          requestLabel: "gemini_generate_content_final_answer",
        })
        if (finalRes.ok) {
          const finalData = (await finalRes.json()) as GeminiResponse
          return { text: extractGeminiText(finalData), inputMode }
        }
      }

      return { text: lastModelText, inputMode }
    }

    return { text: cleanResponseText(lastModelText) || "Unable to complete research.", inputMode }
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
        } catch { /* skip */ }
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

function buildGeminiParts(text: string, attachments: PreparedAttachmentInput[]) {
  return [
    { text },
    ...attachments.map((attachment) => {
      if (attachment.kind === "image") {
        return toGeminiImagePart(attachment)
      }
      return { text: renderTextAttachmentBlock(attachment) }
    }),
  ]
}

function toGeminiImagePart(image: PreparedAttachmentInput) {
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
      mime_type: image.mimeType || "image/png",
      file_uri: image.url || "",
    },
  }
}

function extractGeminiText(data: GeminiResponse): string {
  const raw = (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  )
  return cleanResponseText(raw)
}

function buildGeminiToolConfig(
  tools: Array<{ name: string }>,
  toolPolicyDecision?: ChatToolPolicyDecision
): GeminiToolConfig | undefined {
  if (!toolPolicyDecision) return undefined
  if (toolPolicyDecision.geminiMode === "NONE") {
    return { function_calling_config: { mode: "NONE" } }
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
  return { function_calling_config: { mode: "AUTO" } }
}

function isGemmaModel(model: string): boolean {
  return /^gemma[-_]/i.test(model)
}

interface GeminiToolConfig {
  function_calling_config?: {
    mode: "AUTO" | "ANY" | "NONE"
    allowed_function_names?: string[]
  }
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
  return msg.includes("system_instruction") || (msg.includes("system") && msg.includes("not supported"))
}
