import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class AnthropicAdapter implements LLMAdapter {
  readonly provider: Provider = "anthropic"
  constructor(private key: string, public model: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 600,
        messages: [{ role: "user", content: buildChroniclePrompt(meta, events) }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = (await res.json()) as { content?: { text?: string }[] }
    return data.content?.[0]?.text ?? ""
  }
}
