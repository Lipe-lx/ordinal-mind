// Shared prompt for the Chronicle Synthesizer.
// Used by all 3 BYOK adapters. English system prompt, response language adapts to user.

import type { ChronicleEvent, InscriptionMeta } from "../types"

export function buildChroniclePrompt(meta: InscriptionMeta, events: ChronicleEvent[]): string {
  const eventsText = events
    .map(
      (e) =>
        `[${e.timestamp.substring(0, 10)}] ${e.event_type.toUpperCase()}: ${e.description}`
    )
    .join("\n")

  return `You are a factual chronicler of digital Bitcoin artifacts. Write a concise, factual Chronicle for this Ordinal inscription. Use ONLY the data provided below. Do NOT invent any information.

Write in the same language as the user's browser locale if detectable, otherwise default to English.

Tone: objective, with a slight sense of historical weight. Maximum 4 short paragraphs.

INSCRIPTION DATA:
- ID: ${meta.inscription_id}
- Number: #${meta.inscription_number}
- Sat: ${meta.sat.toLocaleString("en-US")} (rarity: ${meta.sat_rarity})
- Content type: ${meta.content_type}
- Genesis block: ${meta.genesis_block}
- Current owner: ${meta.owner_address}
${meta.collection ? `- Collection: ${meta.collection.name ?? "unnamed"}` : ""}

EVENT TIMELINE:
${eventsText}

Write the Chronicle now. Every fact must be backed by the data above.
If something is not in the data, do not mention it.

CRITICAL INSTRUCTION:
Output ONLY the final Chronicle text. Do NOT include any internal thoughts, reasoning, <think> tags, constraints, or scratchpad notes. Do NOT repeat the prompt. Return ONLY the 4 paragraphs of the final narrative.`
}
