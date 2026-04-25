import type { LLMAdapter, Provider } from "./index"
import type { ChronicleEvent, InscriptionMeta } from "../types"
import { buildChroniclePrompt } from "./prompt"

export class GeminiAdapter implements LLMAdapter {
  readonly provider: Provider = "gemini"
  constructor(private key: string, public model: string) {}

  async synthesize(meta: InscriptionMeta, events: ChronicleEvent[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildChroniclePrompt(meta, events) }] }],
        generationConfig: { maxOutputTokens: 600 },
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Gemini error ${res.status}: ${JSON.stringify(err)}`)
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  }
}
