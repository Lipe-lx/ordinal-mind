import type { LLMAdapter, Provider } from "./index"
import type { Chronicle } from "../types"
import type { PreparedImageInput, ProviderCapabilities } from "./context"
import type { SynthesisResult } from "./index"
import { prepareSynthesisInput } from "./context"
import { consumeSSE } from "./streamParser"
import type { ToolExecutor } from "./toolExecutor"

const API_URL = "https://api.anthropic.com/v1/messages"

type AnthropicContent = 
  | { type: string; text?: string }
  | { type: string; source?: { type: string; media_type: string; data: string } }
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
      return await this.requestWithSystemMessage(chronicle, false, undefined, undefined, toolExecutor)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, false, undefined, undefined, toolExecutor)
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
      return await this.requestWithSystemMessage(chronicle, true, onChunk, signal, toolExecutor)
    } catch (err) {
      if (isSystemMessageError(err)) {
        return await this.requestCombined(chronicle, true, onChunk, signal, toolExecutor)
      }
      throw err
    }
  }

  private async requestWithSystemMessage(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys())
    const tools = prepared.searchToolsEnabled ? prepared.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    })) : undefined

    const messages: AnthropicMessage[] = [{ role: "user", content: buildAnthropicContent(prepared.userPrompt, prepared.image) }]
    const inputMode = prepared.inputMode

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
          const toolResultsContent = []
          for (const call of streamResult.toolCalls) {
            const result = await toolExecutor.executeTool(call.name, call.args)
            toolResultsContent.push({
              type: "tool_result",
              tool_use_id: call.id || "",
              content: JSON.stringify(result)
            })
          }
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as AnthropicResponse
        if (data.stop_reason === "tool_use" && toolExecutor) {
          messages.push({ role: "assistant", content: data.content as AnthropicContent[] })
          const toolResultsContent = []
          for (const block of data.content) {
            if (block.type === "tool_use") {
              const result = await toolExecutor.executeTool(block.name!, block.input || {})
              toolResultsContent.push({
                type: "tool_result",
                tool_use_id: block.id || "",
                content: JSON.stringify(result)
              })
            }
          }
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
      }
    }
    
    return { text: "Tool calling limit reached.", inputMode }
  }

  private async requestCombined(
    chronicle: Chronicle,
    stream: boolean,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutor
  ): Promise<SynthesisResult> {
    const prepared = await prepareSynthesisInput(chronicle, this.getCapabilities(), toolExecutor?.getKeys())
    const tools = prepared.searchToolsEnabled ? prepared.availableTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    })) : undefined

    const messages: AnthropicMessage[] = [{ role: "user", content: buildAnthropicContent(prepared.combinedPrompt, prepared.image) }]
    const inputMode = prepared.inputMode

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
          const toolResultsContent = []
          for (const call of streamResult.toolCalls) {
            const result = await toolExecutor.executeTool(call.name, call.args)
            toolResultsContent.push({
              type: "tool_result",
              tool_use_id: call.id || "",
              content: JSON.stringify(result)
            })
          }
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: streamResult.text, inputMode }
      } else {
        const data = (await res.json()) as AnthropicResponse
        if (data.stop_reason === "tool_use" && toolExecutor) {
          messages.push({ role: "assistant", content: data.content as AnthropicContent[] })
          const toolResultsContent = []
          for (const block of data.content) {
            if (block.type === "tool_use") {
              const result = await toolExecutor.executeTool(block.name!, block.input || {})
              toolResultsContent.push({
                type: "tool_result",
                tool_use_id: block.id || "",
                content: JSON.stringify(result)
              })
            }
          }
          messages.push({ role: "user", content: toolResultsContent })
          continue
        }
        return { text: data.content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "", inputMode }
      }
    }
    
    return { text: "Tool calling limit reached.", inputMode }
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

function buildAnthropicContent(text: string, image?: PreparedImageInput) {
  return [
    { type: "text", text },
    ...(image ? [toAnthropicImageBlock(image)] : []),
  ]
}

function toAnthropicImageBlock(image: PreparedImageInput) {
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
