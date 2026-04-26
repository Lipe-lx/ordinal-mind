import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"
import { COLLECTION_RESEARCH_TOOLS } from "./tools"
import type { ToolExecutor } from "./toolExecutor"

const API_URL = "https://openrouter.ai/api/v1/chat/completions"

export class OpenRouterAdapter implements LLMAdapter {
  readonly provider: Provider = "openrouter"
  constructor(private key: string, public model: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.key}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.href : "https://ordinal-mind.com",
      "X-Title": "Ordinal Mind",
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
      return await this.request(chronicle, false, true, undefined, undefined, toolExecutor)
    } catch (err) {
      if (isSystemRoleError(err)) {
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
      if (isSystemRoleError(err)) {
        return await this.request(chronicle, true, false, onChunk, signal, toolExecutor)
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
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities())
    const tools = prepared.searchToolsEnabled ? COLLECTION_RESEARCH_TOOLS.map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    })) : undefined

    let messages: any[] = useSystemRole
      ? [
          { role: "system", content: prepared.systemPrompt },
          {
            role: "user",
            content: buildOpenRouterContent(prepared.userPrompt, prepared.image),
          },
        ]
      : [
          {
            role: "user",
            content: buildOpenRouterContent(prepared.combinedPrompt, prepared.image),
          },
        ]
    
    let inputMode = prepared.inputMode

    for (let i = 0; i < 7; i++) {
      const body: any = {
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
        const data = await res.json() as any
        const message = data.choices?.[0]?.message
        if (message?.tool_calls && toolExecutor) {
          messages.push(message)
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
  ): Promise<{ text: string, toolCalls: Array<{id: string, name: string, args: any}> }> {
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

function buildOpenRouterContent(text: string, image?: PreparedImageInput) {
  if (!image) return text

  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url:
          image.transport === "public_url"
            ? image.url
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
