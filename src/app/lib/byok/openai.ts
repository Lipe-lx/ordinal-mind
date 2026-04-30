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

const API_URL = "https://api.openai.com/v1/chat/completions"

type OpenAIMessage = 
  | { role: "system"; content: string }
  | { role: "user"; content: string | { type: string; text?: string; image_url?: { url: string } }[] }
  | { role: "assistant"; content?: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

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

  async synthesize(chronicle: Chronicle, toolExecutor?: ToolExecutor): Promise<SynthesisResult> {
    try {
      return await this.request(chronicle, false, true, undefined, undefined, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemRoleError(err)) {
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
    try {
      return await this.request(chronicle, true, true, onChunk, signal, toolExecutor, undefined, true)
    } catch (err) {
      if (isSystemRoleError(err)) {
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
      if (isSystemRoleError(err)) {
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
    useSystemRole: boolean,
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
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    })) : undefined

    const messages: OpenAIMessage[] = useSystemRole
      ? [
          { role: "system", content: prepared.systemPrompt },
          { role: "user", content: buildOpenAIContent(userPrompt, attachments) },
        ]
      : [{ role: "user", content: buildOpenAIContent(promptOverride ? `${prepared.systemPrompt}\n\n${userPrompt}` : prepared.combinedPrompt, attachments) }]

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
        throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(err)}`)
      }

      if (stream) {
        const streamResult = await this.consumeOpenAIStreamWithTools(res, onChunk, signal)
        if (streamResult.toolCalls.length > 0 && toolExecutor) {
          messages.push({ role: "assistant", tool_calls: streamResult.toolCalls.map(c => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) }
          }))})
          
          const toolResults = await Promise.all(
            streamResult.toolCalls.map(async (call) => {
              const callKey = `${call.name}:${JSON.stringify(call.args)}`
              if (executedCalls.has(callKey)) {
                return {
                  role: "tool" as const,
                  tool_call_id: call.id,
                  name: call.name,
                  content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                }
              }
              executedCalls.add(callKey)
              const result = await toolExecutor.executeTool(call.name, call.args)
              return {
                role: "tool" as const,
                tool_call_id: call.id,
                name: call.name,
                content: JSON.stringify(result)
              }
            })
          )
          messages.push(...toolResults)
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as OpenAIResponse
        const message = data.choices?.[0]?.message
        if (message?.tool_calls && toolExecutor) {
          messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls } as OpenAIMessage)
          const toolResults = await Promise.all(
            message.tool_calls.map(async (call) => {
              const args = JSON.parse(call.function.arguments)
              const callKey = `${call.function.name}:${JSON.stringify(args)}`
              if (executedCalls.has(callKey)) {
                return {
                  role: "tool" as const,
                  tool_call_id: call.id,
                  name: call.function.name,
                  content: JSON.stringify({ error: "Redundant call detected. Use existing data." })
                }
              }
              executedCalls.add(callKey)
              const result = await toolExecutor.executeTool(call.function.name, args)
              return {
                role: "tool" as const,
                tool_call_id: call.id,
                name: call.function.name,
                content: JSON.stringify(result)
              }
            })
          )
          messages.push(...toolResults)
          continue
        }
        return { text: message?.content ?? "", inputMode }
      }
    }

    // Tool calling limit reached - synthesize response from collected data
    if (messages.length > (useSystemRole ? 2 : 1)) {
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
          const finalData = (await finalRes.json()) as OpenAIResponse
          return { text: finalData.choices?.[0]?.message?.content ?? "", inputMode }
        }
      } catch (e) {
        console.warn("[OpenAIAdapter] Final synthesis request failed", e)
      }
    }

    return { text: "Unable to complete research due to tool limit.", inputMode }
  }

  private async consumeOpenAIStreamWithTools(
    res: Response,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<{ text: string, toolCalls: Array<{id: string, name: string, args: Record<string, unknown>}> }> {
    let accumulatedText = ""
    const toolCallsMap: Record<number, {id: string, name: string, argsStr: string}> = {}

    await consumeSSE(
      res,
      (data) => {
        try {
          if (data === "[DONE]") return
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta

          if (delta?.content) {
            accumulatedText += delta.content
            if (onChunk) onChunk(delta.content)
          }

          if (delta?.tool_calls) {
            for (const call of delta.tool_calls) {
              const index = call.index
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = { id: call.id, name: call.function?.name ?? "", argsStr: "" }
              }
              if (call.function?.arguments) {
                toolCallsMap[index].argsStr += call.function.arguments
              }
            }
          }
        } catch {
          // Skip unparseable chunks
        }
      },
      signal
    )

    const toolCalls = Object.values(toolCallsMap).map(tc => {
      try {
        return { id: tc.id, name: tc.name, args: JSON.parse(tc.argsStr || "{}") }
      } catch {
        return { id: tc.id, name: tc.name, args: {} }
      }
    })

    return { text: accumulatedText, toolCalls }
  }
}

function buildOpenAIContent(text: string, attachments: PreparedAttachmentInput[]) {
  if (attachments.length === 0) return text

  return [
    { type: "text", text },
    ...attachments.map((attachment) => {
      if (attachment.kind === "image") {
        return {
          type: "image_url",
          image_url: {
            url:
              attachment.transport === "public_url"
                ? (attachment.url || "")
                : `data:${attachment.mimeType};base64,${attachment.data}`,
          },
        }
      }

      return {
        type: "text",
        text: renderTextAttachmentBlock(attachment),
      }
    }),
  ]
}

function isSystemRoleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
