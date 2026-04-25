import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class OpenRouterAdapter implements LLMAdapter {
  readonly provider: Provider = "openrouter"
  constructor(private key: string, public model: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.key}`,
        "HTTP-Referer": window.location.href, // Recommended by OpenRouter
        "X-Title": "Ordinal Mind", // Recommended by OpenRouter
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 600,
        messages: [{ role: "user", content: buildChroniclePrompt(meta, events) }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`OpenRouter error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ""
  }
}
