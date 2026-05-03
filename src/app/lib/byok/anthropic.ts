import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedAttachmentInput, ProviderCapabilities } from "./context"
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

const API_URL = "https://api.anthropic.com/v1/messages"

type AnthropicContent = 
  | { type: string; text?: string }
  | { type: string; source?: { type: string; media_type?: string; data?: string; url?: string } }
  | { type: string; id?: string; name?: string; input?: Record<string, unknown> }
  | { type: string; tool_use_id?: string; content?: string };

type AnthropicMessage = 
  | { role: "user"; content: string | AnthropicContent[] }
  | { role: "assistant"; content: string | AnthropicContent[] };

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

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

  async synthesize(chronicle: Chronicle, toolExecutor?: ToolExecutor): Promise<SynthesisResult> {
    try {
      return await this.requestWithSystemMessage(chronicle, false, undefined, undefined, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, false, undefined, undefined, toolExecutor, undefined, true)
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
      return await this.requestWithSystemMessage(chronicle, true, onChunk, signal, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, true, onChunk, signal, toolExecutor, undefined, true)
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
    wikiCompletenessInfo,
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
    wikiCompletenessInfo?: string
    onChunk: (text: string) => void
    signal?: AbortSignal
    toolExecutor?: ToolExecutor
  }): Promise<SynthesisResult> {
    const conversationPrompt = buildChatTurnPrompt(
      chronicle,
      history,
      userMessage || INITIAL_NARRATIVE_PROMPT,
      { mode, intent, wikiCompletenessInfo }
    )
    const enableAttachments = shouldAttachContentForChat({
      chronicle,
      history,
      userMessage: userMessage || INITIAL_NARRATIVE_PROMPT,
      mode,
      intent,
    })

    try {
      return await this.requestWithSystemMessage(
        chronicle,
        true,
        onChunk,
        signal,
        toolExecutor,
        conversationPrompt,
        enableAttachments,
        toolPolicyDecision
      )
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(
          chronicle,
          true,
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

  private async requestWithSystemMessage(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor,
    promptOverride?: string,
    allowAttachments = true,
    toolPolicyDecision?: ChatToolPolicyDecision
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys(), toolPolicyDecision)
    const userPrompt = promptOverride ?? prepared.userPrompt
    const attachments = allowAttachments ? prepared.attachments : []
    const tools = prepared.searchToolsEnabled ? prepared.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    })) : undefined

    const messages: AnthropicMessage[] = [{ role: "user", content: buildAnthropicContent(userPrompt, attachments) }]
    const inputMode = allowAttachments ? prepared.inputMode : "text-only"
    const executedCalls = new Set<string>()

    for (let i = 0; i < 7; i++) {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: 600,
        system: prepared.systemPrompt,
        messages,
        stream,
      }
      if (tools && tools.length > 0) {
        body.tools = tools
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

      if (stream) {
        const streamResult = await this.consumeAnthropicStreamWithTools(res, onChunk, signal)
        if (streamResult.toolCalls.length > 0 && toolExecutor) {
          messages.push({ role: "assistant", content: streamResult.assistantContent as AnthropicContent[] })
          const toolResultsContent = await Promise.all(
            streamResult.toolCalls.map(async (call) => {
              const callKey = `${call.name}:${JSON.stringify(call.args)}`
              if (executedCalls.has(callKey)) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: call.id || "",
                  content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                }
              }
              executedCalls.add(callKey)
              const result = await toolExecutor.executeTool(call.name, call.args)
              return {
                type: "tool_result" as const,
                tool_use_id: call.id || "",
                content: JSON.stringify(result)
              }
            })
          )
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as AnthropicResponse
        if (data.stop_reason === "tool_use" && toolExecutor) {
          messages.push({ role: "assistant", content: data.content as AnthropicContent[] })
          const toolResultsContent = await Promise.all(
            data.content
              .filter((block) => block.type === "tool_use")
              .map(async (block) => {
                const callKey = `${block.name}:${JSON.stringify(block.input || {})}`
                if (executedCalls.has(callKey)) {
                  return {
                    type: "tool_result" as const,
                    tool_use_id: block.id || "",
                    content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                  }
                }
                executedCalls.add(callKey)
                const result = await toolExecutor.executeTool(block.name!, block.input || {})
                return {
                  type: "tool_result" as const,
                  tool_use_id: block.id || "",
                  content: JSON.stringify(result)
                }
              })
          )
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
      }
    }
    
    // Tool calling limit reached - synthesize response from collected data
    if (messages.length > 1) {
      messages.push({
        role: "user",
        content: "Based on the research conducted, provide your best direct answer to the user's original question. If data is incomplete, acknowledge it but still provide the most helpful response you can with available information."
      })

      try {
        const body: Record<string, unknown> = {
          model: this.model,
          max_tokens: 600,
          system: prepared.systemPrompt,
          messages,
        }

        const finalRes = await fetch(API_URL, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        })

        if (finalRes.ok) {
          const finalData = (await finalRes.json()) as AnthropicResponse
          return { text: finalData.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
        }
      } catch (e) {
        console.warn("[AnthropicAdapter] Final synthesis request failed", e)
      }
    }

    return { text: "Unable to complete research due to tool limit.", inputMode }
  }

  private async requestCombined(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor,
    promptOverride?: string,
    allowAttachments = true,
    toolPolicyDecision?: ChatToolPolicyDecision
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys(), toolPolicyDecision)
    const userPrompt = promptOverride
      ? `${prepared.systemPrompt}\n\n${promptOverride}`
      : prepared.combinedPrompt
    const attachments = allowAttachments ? prepared.attachments : []
    const tools = prepared.searchToolsEnabled ? prepared.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    })) : undefined

    const messages: AnthropicMessage[] = [{ role: "user", content: buildAnthropicContent(userPrompt, attachments) }]
    const inputMode = allowAttachments ? prepared.inputMode : "text-only"
    const executedCalls = new Set<string>()

    for (let i = 0; i < 7; i++) {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: 600,
        messages,
        stream,
      }
      if (tools && tools.length > 0) {
        body.tools = tools
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

      if (stream) {
        const streamResult = await this.consumeAnthropicStreamWithTools(res, onChunk, signal)
        if (streamResult.toolCalls.length > 0 && toolExecutor) {
          messages.push({ role: "assistant", content: streamResult.assistantContent as AnthropicContent[] })
          const toolResultsContent = await Promise.all(
            streamResult.toolCalls.map(async (call) => {
              const callKey = `${call.name}:${JSON.stringify(call.args)}`
              if (executedCalls.has(callKey)) {
                return {
                  type: "tool_result" as const,
                  tool_use_id: call.id || "",
                  content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                }
              }
              executedCalls.add(callKey)
              const result = await toolExecutor.executeTool(call.name, call.args)
              return {
                type: "tool_result" as const,
                tool_use_id: call.id || "",
                content: JSON.stringify(result)
              }
            })
          )
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as AnthropicResponse
        if (data.stop_reason === "tool_use" && toolExecutor) {
          messages.push({ role: "assistant", content: data.content as AnthropicContent[] })
          const toolResultsContent = await Promise.all(
            data.content
              .filter((block) => block.type === "tool_use")
              .map(async (block) => {
                const callKey = `${block.name}:${JSON.stringify(block.input || {})}`
                if (executedCalls.has(callKey)) {
                  return {
                    type: "tool_result" as const,
                    tool_use_id: block.id || "",
                    content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                  }
                }
                executedCalls.add(callKey)
                const result = await toolExecutor.executeTool(block.name!, block.input || {})
                return {
                  type: "tool_result" as const,
                  tool_use_id: block.id || "",
                  content: JSON.stringify(result)
                }
              })
          )
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
      }
    }
    
    // Tool calling limit reached - synthesize response from collected data
    if (messages.length > 1) {
      messages.push({
        role: "user",
        content: "Based on the research conducted, provide your best direct answer to the user's original question. If data is incomplete, acknowledge it but still provide the most helpful response you can with available information."
      })

      try {
        const body: Record<string, unknown> = {
          model: this.model,
          max_tokens: 600,
          messages,
        }

        const finalRes = await fetch(API_URL, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        })

        if (finalRes.ok) {
          const finalData = (await finalRes.json()) as AnthropicResponse
          return { text: finalData.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
        }
      } catch (e) {
        console.warn("[AnthropicAdapter] Final synthesis request failed", e)
      }
    }

    return { text: "Unable to complete research due to tool limit.", inputMode }
  }

  private async consumeAnthropicStreamWithTools(
    res: Response,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string, toolCalls: Array<{id: string, name: string, args: Record<string, unknown>}>, assistantContent: AnthropicContent[] }> {
    let accumulatedText = ""
    const toolCalls: Array<{id: string, name: string, args: Record<string, unknown>}> = []
    const assistantContent: AnthropicContent[] = []

    let currentToolId = ""
    let currentToolName = ""
    let currentToolInput = ""

    await consumeSSE(
      res,
      (data) => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === "content_block_start") {
            if (parsed.content_block.type === "tool_use") {
              currentToolId = parsed.content_block.id
              currentToolName = parsed.content_block.name
              currentToolInput = ""
            }
          } else if (parsed.type === "content_block_delta") {
            if (parsed.delta.type === "text_delta") {
              accumulatedText += parsed.delta.text
              if (onChunk) onChunk(parsed.delta.text)
            } else if (parsed.delta.type === "input_json_delta") {
              currentToolInput += parsed.delta.partial_json
            }
          } else if (parsed.type === "content_block_stop") {
            if (currentToolId) {
              const args = JSON.parse(currentToolInput || "{}")
              toolCalls.push({ id: currentToolId, name: currentToolName, args })
              assistantContent.push({
                type: "tool_use",
                id: currentToolId,
                name: currentToolName,
                input: args
              })
              currentToolId = ""
            } else if (accumulatedText.length > 0 && assistantContent.length === 0) {
               // Only push text if it's a text block stopping
               assistantContent.push({ type: "text", text: accumulatedText })
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      },
      signal
    )

    if (accumulatedText.length > 0 && assistantContent.length === 0) {
       assistantContent.push({ type: "text", text: accumulatedText })
    }

    return { text: accumulatedText, toolCalls, assistantContent }
  }
}

function buildAnthropicContent(text: string, attachments: PreparedAttachmentInput[]) {
  return [
    { type: "text", text },
    ...attachments.map((attachment) => {
      if (attachment.kind === "image") {
        return toAnthropicImageBlock(attachment)
      }
      return { type: "text", text: renderTextAttachmentBlock(attachment) }
    }),
  ]
}

function toAnthropicImageBlock(image: PreparedAttachmentInput) {
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
