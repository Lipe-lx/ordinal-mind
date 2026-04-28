import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { ProviderCapabilities, PreparedImageInput } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"
import type { ToolExecutor } from "./toolExecutor"
import type { ChatMessage } from "./chatTypes"
import { buildChatTurnPrompt, INITIAL_NARRATIVE_PROMPT } from "./prompt"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"

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
    onChunk,
    signal,
    toolExecutor,
  }: {
    chronicle: Chronicle
    history: ChatMessage[]
    userMessage: string
    mode: ChatResponseMode
    intent: ChatIntent
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

    try {
      return await this.request(
        chronicle,
        true,
        true,
        onChunk,
        signal,
        toolExecutor,
        conversationPrompt,
        enableVision
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
          enableVision
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
    allowVisionInput = true
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys())
    const userPrompt = promptOverride ?? prepared.userPrompt
    const image = allowVisionInput ? prepared.image : undefined
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
          { role: "user", content: buildOpenAIContent(userPrompt, image) },
        ]
      : [{ role: "user", content: buildOpenAIContent(promptOverride ? `${prepared.systemPrompt}\n\n${userPrompt}` : prepared.combinedPrompt, image) }]

    const inputMode = allowVisionInput ? prepared.inputMode : "text-only"

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
        const data = (await res.json()) as OpenAIResponse
        const message = data.choices?.[0]?.message
        if (message?.tool_calls && toolExecutor) {
          messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls } as OpenAIMessage)
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

function buildOpenAIContent(text: string, image?: PreparedImageInput) {
  if (!image) return text

  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url:
          image.transport === "public_url"
            ? (image.url || "")
            : `data:${image.mimeType};base64,${image.data}`,
      },
    },
  ]
}

function isSystemRoleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes("system") && (msg.includes("not supported") || msg.includes("invalid"))
}
