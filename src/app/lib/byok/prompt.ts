// Chronicle Synthesizer prompts — split into system + user.
// System prompt contains role + constraints (never seen by end user).
// User prompt contains only the inscription data.

import type { ChronicleEvent, InscriptionMeta } from "../types"

/**
 * System prompt: role definition, constraints, and output format rules.
 * Sent as `system` message where the API supports it.
 */
export function buildSystemPrompt(): string {
  return `You are a factual chronicler of digital Bitcoin artifacts.

Your task is to write a concise, factual Chronicle for an Ordinal inscription using ONLY the data provided by the user. Do NOT invent any information.

Rules:
- Write in the same language as the user's browser locale if detectable, otherwise default to English.
- Tone: objective, with a slight sense of historical weight.
- Maximum 4 short paragraphs.
- Every fact must be backed by the provided data. If something is not in the data, do not mention it.
- Output ONLY the final Chronicle text. No internal thoughts, reasoning, constraints, scratchpad notes, or prompt repetition.`
}

/**
 * User prompt: inscription data + timeline events.
 * This is what varies per request.
 */
export function buildUserPrompt(meta: InscriptionMeta, events: ChronicleEvent[]): string {
  const eventsText = events
    .map(
      (e) =>
        `[${e.timestamp.substring(0, 10)}] ${e.event_type.toUpperCase()}: ${e.description}`
    )
    .join("\n")

  return `Write a Chronicle for this Ordinal inscription:

ID: ${meta.inscription_id}
Number: #${meta.inscription_number}
Sat: ${meta.sat.toLocaleString("en-US")} (rarity: ${meta.sat_rarity})
Content type: ${meta.content_type}
Genesis block: ${meta.genesis_block}
Current owner: ${meta.owner_address}
${meta.collection ? `Collection: ${meta.collection.name ?? "unnamed"}` : ""}

Timeline:
${eventsText}

Write the Chronicle now.`
}

/**
 * Combined prompt for providers that don't support system messages.
 * Falls back to a single user message containing both parts.
 */
export function buildCombinedPrompt(meta: InscriptionMeta, events: ChronicleEvent[]): string {
  return `${buildSystemPrompt()}\n\n${buildUserPrompt(meta, events)}`
}
