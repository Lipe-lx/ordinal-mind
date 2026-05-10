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

const API_URL = "https://openrouter.ai/api/v1/chat/completions"

type OpenRouterMessage = 
  | { role: "system"; content: string }
  | { role: "user"; content: string | { type: string; text?: string; image_url?: { url: string } }[] }
  | { role: "assistant"; content?: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

interface OpenRouterResponse {
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

export class OpenRouterAdapter implements LLMAdapter {
  readonly provider: Provider = "openrouter"
  constructor(private key: string, public model: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.key}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinalmind.com",
      "X-Title": "OrdinalMind",
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsVisionInput: true,
      supportsToolCalling: false,
      imageTransport: "public_url",
      preferredApi: "chat_completions",
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
    wikiCompletenessInfo,
    wikiPage,
    wikiStatus,
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
    wikiPage?: import("../wikiTypes").WikiPage | null
    wikiStatus?: string
    onChunk: (text: string) => void
    signal?: AbortSignal
    toolExecutor?: ToolExecutor
  }): Promise<SynthesisResult> {
    const conversationPrompt = buildChatTurnPrompt(
      chronicle,
      history,
      userMessage || INITIAL_NARRATIVE_PROMPT,
      { mode, intent, wikiCompletenessInfo, wikiPage, wikiStatus }
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
        toolPolicyDecision,
        wikiPage,
        wikiCompletenessInfo
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
          toolPolicyDecision,
          wikiPage,
          wikiCompletenessInfo
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
  , wikiPage?: import("../wikiTypes").WikiPage | null, wikiCompletenessInfo?: string): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys(), toolPolicyDecision, { wikiPage, wikiCompletenessInfo })
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

    const messages: OpenRouterMessage[] = useSystemRole
      ? [
          { role: "system", content: prepared.systemPrompt },
          {
            role: "user",
            content: buildOpenRouterContent(userPrompt, attachments),
          },
        ]
      : [
          {
            role: "user",
            content: buildOpenRouterContent(promptOverride ? `${prepared.systemPrompt}\n\n${userPrompt}` : prepared.combinedPrompt, attachments),
          },
        ]
    
    const inputMode = allowAttachments ? prepared.inputMode : "text-only"

    for (let i = 0; i < 7; i++) {
      const body: Record<string, unknown> = {
        model: this.model,
        max_tokens: 2048,
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
        throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(err)}`)
      }

      if (stream) {
        const streamResult = await this.consumeOpenRouterStreamWithTools(res, onChunk, signal)
        if (streamResult.toolCalls.length > 0 && toolExecutor) {
          messages.push({ role: "assistant", tool_calls: streamResult.toolCalls.map(c => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) }
          }))})
          
          for (const call of streamResult.toolCalls) {
            const result = await toolExecutor.executeTool(call.name, call.args)
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify(result)
            })
          }
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as OpenRouterResponse
        const message = data.choices?.[0]?.message
        if (message?.tool_calls && toolExecutor) {
          messages.push(message as OpenRouterMessage)
          for (const call of message.tool_calls) {
             const args = JSON.parse(call.function.arguments)
             const result = await toolExecutor.executeTool(call.function.name, args)
             messages.push({
                role: "tool",
                tool_call_id: call.id,
                name: call.function.name,
                content: JSON.stringify(result)
             })
          }
          continue
        }
        return { text: message?.content ?? "", inputMode }
      }
    }

    return { text: "Tool calling limit reached.", inputMode }
  }

  private async consumeOpenRouterStreamWithTools(
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

          if (parsed.error) {
            console.error("[OpenRouter] mid-stream error:", parsed.error)
            return
          }

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

function buildOpenRouterContent(text: string, attachments: PreparedAttachmentInput[]) {
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
