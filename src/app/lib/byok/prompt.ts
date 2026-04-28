// Chronicle Synthesizer prompts — split into system + user.
// System prompt contains role + constraints (never seen by end user).
// User prompt contains only the inscription data.

import type { Chronicle, ChronicleEvent, ProtocolRelationSet, RelatedInscriptionSummary } from "../types"
import type { ChatMessage } from "./chatTypes"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"

import { SearchToolDefinition } from "./tools"

/**
 * System prompt: role definition, constraints, and output format rules.
 * Sent as `system` message where the API supports it.
 */
export function buildSystemPrompt(availableTools: SearchToolDefinition[] = []): string {
  const supportsTools = availableTools.length > 0
  const baseRules = `You are a factual chronicler of digital Bitcoin artifacts.

Your task is to write a collector-grade, factual Chronicle for an Ordinal inscription using ONLY the data provided by the user. Do NOT invent any information.

Rules:
- Write in the same language as the user's browser locale if detectable, otherwise default to English.
- Tone: objective, vivid, and historically aware. Avoid hype copy.
- Maximum 5 short paragraphs.
- Every fact must be backed by the provided data. If something is not in the data, do not mention it.
- Do not repeat the visible metadata as a checklist. Use identity, block, owner, and transfers only when they explain why the artifact matters.
- If collection profile data exists, lead with the collection's factual story, creators, milestones, and collector signals before zooming into this specific inscription.
- Explain the relationship between this inscription and the collection: on-chain parent/provenance, curated registry match, and market overlay are separate evidence layers.
- Prefer collector-relevant meaning: distribution method, creator roles, supply/index signals, provenance mechanism, notable milestones, and what remains uncertain.
- Treat protocol-native relations as higher trust than curated registry matches.
- Parent provenance and galleries are different mechanisms. Never imply that a gallery or curated match creates an on-chain parent-child relationship.
- If a section says data is partial, sampled, or unresolved, keep that uncertainty explicit.
- Output ONLY the final Chronicle text. No internal thoughts, reasoning, constraints, scratchpad notes, or prompt repetition.`

  if (!supportsTools) return baseRules


  const toolNames = availableTools.map(t => t.name).join(", ")
  return `${baseRules}

You have access to research tools. Before writing the Chronicle, research the collection this inscription belongs to. Focus on:
- Origin story and creators
- Cultural significance in the Ordinals ecosystem
- Notable milestones (launches, airdrops, auctions, partnerships)
- Community reception and collector interest over time
- Market trajectory and notable price events

Available tools: ${toolNames}.
Use 2-5 tool calls to gather context. Cite sources with URLs.
After research, write the Chronicle integrating on-chain data and cultural context.

If tools are unavailable or return no results, write using only provided factual data.`
}

/**
 * User prompt: inscription data + timeline events.
 * This is what varies per request.
 */
export function buildUserPrompt(chronicle: Chronicle): string {
  return `Write a Chronicle for this Ordinal inscription using the structured factual context below.

${buildSynthesisContext(chronicle)}

Write the Chronicle now.`
}

/**
 * Combined prompt for providers that don't support system messages.
 * Falls back to a single user message containing both parts.
 */
export function buildCombinedPrompt(chronicle: Chronicle, availableTools: SearchToolDefinition[] = []): string {
  return `${buildSystemPrompt(availableTools)}\n\n${buildUserPrompt(chronicle)}`
}

export const INITIAL_NARRATIVE_PROMPT =
  "Present the Chronicle as a concise factual narrative, then be ready for follow-up questions about provenance, transfers, collection context, and uncertainties."

export function buildChatSeedPrompt(chronicle: Chronicle): string {
  return `You are in an ongoing Chronicle chat.

Use the factual context below as the authoritative source of truth.
Never invent events, dates, transfers, sales, rarity details, or social signals.
If data is missing or uncertain, say so explicitly.

${buildSynthesisContext(chronicle)}`
}

export function buildChatTurnPrompt(
  chronicle: Chronicle,
  history: ChatMessage[],
  userMessage: string,
  options: {
    mode: ChatResponseMode
    intent: ChatIntent
  }
): string {
  const { mode, intent } = options
  const transcript = history
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n")

  const historySection = transcript
    ? `Conversation so far:\n${transcript}`
    : "Conversation so far:\n(no prior turns)"

  return `${buildChatSeedPrompt(chronicle)}

${historySection}

Latest user message:
${userMessage}

${buildChatPolicyBlock(mode, intent)}`
}

function buildChatPolicyBlock(mode: ChatResponseMode, intent: ChatIntent): string {
  if (mode === "narrative") {
    return `Response policy:
- Provide a concise collector-grade Chronicle narrative (max 5 short paragraphs).
- Keep strict factual precision and explicit uncertainty when data is partial.
- Do not include internal reasoning or prompt text.`
  }

  const intentSpecific = intent === "chronicle_query"
    ? "- Answer the latest user question directly in the first sentence.\n- For short factoid questions (who/when/where/how many), use format: direct answer + optional 1 evidence sentence.\n- Do not recap the full Chronicle unless explicitly requested.\n- Use extra detail only if the user asks to expand."
    : "- Keep response short and conversational (1-2 sentences)."

  return `Response policy:
${intentSpecific}
- Preserve factual precision and acknowledge uncertainty when relevant.
- If the user asks for a recap/resumo/narrativa, then expand into a full narrative.`
}

export function buildSynthesisContext(chronicle: Chronicle): string {
  const { meta, events, media_context, collection_context, source_catalog } = chronicle

  const collectionName = collection_context.presentation.full_label || collection_context.presentation.primary_label
  const collectionSlug = collection_context.market.match?.collection_slug ?? collection_context.registry.match?.slug

  const sections = [
    buildSection("Collection Focus", [
      collectionName ? `Name: ${collectionName}` : null,
      collectionSlug ? `Slug: ${collectionSlug}` : null,
      "Instruction: Prioritize researching this collection rather than the specific inscription.",
    ].filter((v): v is string => Boolean(v))),
    buildSection("Identity", [
      `ID: ${meta.inscription_id}`,
      `Number: #${meta.inscription_number?.toLocaleString() ?? "—"}`,
      `Sat: ${meta.sat?.toLocaleString("en-US") ?? "—"} (${meta.sat_rarity})`,
      `Content type: ${meta.content_type}`,
      `Genesis block: ${meta.genesis_block?.toLocaleString() ?? "—"}`,
      `Genesis timestamp: ${meta.genesis_timestamp}`,
      `Genesis owner: ${meta.genesis_owner_address ?? "unknown"}`,
      `Current owner: ${meta.owner_address}`,
      meta.collection
        ? `Parent collection link: ${meta.collection.name ?? meta.collection.parent_inscription_id}`
        : "Parent collection link: none",
    ]),
    buildSection("Media", [
      `Kind: ${media_context.kind}`,
      `Vision eligible: ${media_context.vision_eligible ? "yes" : "no"}`,
      `Content URL: ${media_context.content_url}`,
      media_context.fallback_reason
        ? `Fallback reason: ${media_context.fallback_reason}`
        : "Fallback reason: none",
    ]),
    buildSection("Collector focus", buildCollectorFocus(chronicle)),
    buildSection("Collection profile", buildCollectionProfileSection(chronicle)),
    buildSection("On-chain facts", buildTimelineSummary(events)),
    buildSection("Web Lore & Context", buildWebResearchSection(chronicle)),
    buildSection("Transfers", summarizeEvents(events, ["transfer", "sale"], 12)),
    buildSection(
      "Parents",
      summarizeRelationSet(
        collection_context.protocol.parents,
        (item) => describeRelatedInscription(item)
      )
    ),
    buildSection(
      "Children",
      summarizeRelationSet(
        collection_context.protocol.children,
        (item) => describeRelatedInscription(item)
      )
    ),
    buildSection(
      "Gallery sample",
      collection_context.protocol.gallery
        ? [
            `Gallery root: ${collection_context.protocol.gallery.gallery_id}`,
            `Sample size: ${collection_context.protocol.gallery.total_count}${collection_context.protocol.gallery.more ? "+" : ""}`,
            ...collection_context.protocol.gallery.items.map((item) => `- ${describeRelatedInscription(item)}`),
          ]
        : ["No protocol gallery sample found."],
    ),
    buildSection(
      "Curated collection match",
      collection_context.registry.match
        ? [
            `Matched collection: ${collection_context.registry.match.matched_collection}`,
            `Match type: ${collection_context.registry.match.match_type}`,
            `Slug: ${collection_context.registry.match.slug}`,
            `Quality state: ${collection_context.registry.match.quality_state}`,
            `Registry IDs: ${collection_context.registry.match.registry_ids.join(", ")}`,
            collection_context.registry.match.issues.length
              ? `Issues: ${collection_context.registry.match.issues.join(" | ")}`
              : "Issues: none",
          ]
        : ["No curated registry match found."],
    ),
    buildSection(
      "Market overlay",
      collection_context.market.match
        ? [
            `Collection: ${collection_context.market.match.collection_name}`,
            `Slug: ${collection_context.market.match.collection_slug}`,
            `Verified: ${collection_context.market.match.verified ? "yes" : "no"}`,
            `Item name: ${collection_context.market.match.item_name ?? "unknown"}`,
            `Collection href: ${collection_context.market.match.collection_href}`,
            collection_context.socials.official_x_profiles.length > 0
              ? `Official X accounts: ${collection_context.socials.official_x_profiles.map((profile) => profile.url).join(", ")}`
              : "Official X accounts: none found",
          ]
        : ["No market overlay match found."],
    ),
    buildSection("Uncertainties", buildUncertainties(chronicle)),
    buildSection(
      "Sources",
      source_catalog.length > 0
        ? source_catalog.map((source) =>
            `- ${source.source_type} · ${source.trust_level} · ${source.partial ? "partial" : "ok"} · ${source.url_or_ref}`
          )
        : ["No source catalog entries recorded."],
    ),
  ]

  return sections.join("\n\n")
}

function buildCollectorFocus(chronicle: Chronicle): string[] {
  const { collection_context, events, meta } = chronicle
  const collectionName =
    collection_context.profile?.name ??
    collection_context.registry.match?.matched_collection ??
    collection_context.market.match?.collection_name

  const transferCount = events.filter((event) => event.event_type === "transfer" || event.event_type === "sale").length
  const focus = [
    collectionName
      ? `Primary lens: this inscription should be interpreted first as part of ${collectionName}, then as an individual inscription.`
      : "Primary lens: no collection context was found, so focus on the inscription's own provenance and media.",
    `Collector value cues available: ${[
      collection_context.protocol.parents?.items.length ? "on-chain parent provenance" : null,
      collection_context.registry.match ? "curated registry match" : null,
      collection_context.market.match ? "market collection overlay" : null,
      collection_context.profile ? "collection history profile" : null,
      transferCount ? `${transferCount} transfer/sale event${transferCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(", ") || "basic inscription metadata only"}.`,
    `Do not spend the opening repeating #${meta.inscription_number}, content type, sat, and block unless tied to the collection or provenance story.`,
  ]

  return focus
}

function buildCollectionProfileSection(chronicle: Chronicle): string[] {
  const profile = chronicle.collection_context.profile
  if (!profile) return ["No collection story profile found."]

  const lines = [
    `Name: ${profile.name}`,
    `Slug: ${profile.slug}`,
    profile.summary ? `Summary: ${profile.summary}` : "Summary: unavailable",
  ]

  if (profile.creators.length > 0) {
    lines.push("Creators and roles:")
    for (const fact of profile.creators) {
      lines.push(`- ${fact.label}: ${fact.value} (${fact.source_ref})`)
    }
  }

  if (profile.milestones.length > 0) {
    lines.push("Milestones:")
    for (const fact of profile.milestones) {
      lines.push(`- ${fact.label}: ${fact.value} (${fact.source_ref})`)
    }
  }

  if (profile.collector_signals.length > 0) {
    lines.push("Collector signals:")
    for (const fact of profile.collector_signals) {
      lines.push(`- ${fact.label}: ${fact.value} (${fact.source_ref})`)
    }
  }

  if (profile.market_stats) {
    lines.push("Market stats from public collection page:")
    lines.push(...formatMarketStats(profile.market_stats))
  }

  return lines
}

function buildWebResearchSection(chronicle: Chronicle): string[] {
  const research = chronicle.web_research
  if (!research || research.results.length === 0) {
    return ["No baseline web research context available."]
  }

  const lines = [
    `Research Query: ${research.query}`,
    `Fetched at: ${research.fetched_at}`,
    "Found Articles and Content:"
  ]

  for (const item of research.results) {
    lines.push(`- Title: ${item.title}`)
    lines.push(`  URL: ${item.url}`)
    lines.push(`  Snippet: ${item.snippet}`)
    if (item.content) {
      // Limit content per article to avoid token explosion
      const cleanContent = item.content.replace(/\s+/g, " ").trim()
      lines.push(`  Content: ${cleanContent.substring(0, 1500)}...`)
    }
  }

  return lines
}

function formatMarketStats(stats: NonNullable<Chronicle["collection_context"]["profile"]>["market_stats"]): string[] {
  if (!stats) return []

  return [
    stats.floor_price ? `- Floor: ${stats.floor_price}` : null,
    stats.change_7d ? `- 7D change: ${stats.change_7d}` : null,
    stats.volume_7d ? `- 7D volume: ${stats.volume_7d}` : null,
    stats.supply ? `- Supply: ${stats.supply}` : null,
    stats.listed ? `- Listed: ${stats.listed}` : null,
    stats.market_cap ? `- Market cap: ${stats.market_cap}` : null,
    `- Source: ${stats.source_ref}`,
  ].filter((line): line is string => Boolean(line))
}

function buildTimelineSummary(events: ChronicleEvent[]): string[] {
  const summary = summarizeEvents(events, ["genesis", "sat_context", "collection_link", "recursive_ref"], 10)
  return summary.length > 0 ? summary : ["No additional on-chain context beyond genesis."]
}

function summarizeEvents(
  events: ChronicleEvent[],
  eventTypes: ChronicleEvent["event_type"][],
  limit: number
): string[] {
  const filtered = events
    .filter((event) => eventTypes.includes(event.event_type))
    .slice(0, limit)
    .map((event) => `- [${event.timestamp.slice(0, 10)}] ${event.event_type}: ${event.description}`)

  return filtered.length > 0 ? filtered : ["No events in this section."]
}

function summarizeRelationSet(
  relationSet: ProtocolRelationSet | null,
  formatter: (value: RelatedInscriptionSummary) => string
): string[] {
  if (!relationSet || relationSet.items.length === 0) {
    return ["No related inscriptions found."]
  }

  const lines = [
    `Returned count: ${relationSet.total_count}`,
    `More pages available: ${relationSet.more ? "yes" : "no"}`,
  ]

  for (const item of relationSet.items) {
    lines.push(`- ${formatter(item)}`)
  }

  return lines
}

function buildUncertainties(chronicle: Chronicle): string[] {
  const uncertainties: string[] = []
  const { collection_context, media_context } = chronicle

  if (media_context.fallback_reason) {
    uncertainties.push(`- Media fallback: ${media_context.fallback_reason}`)
  }

  if (collection_context.protocol.parents?.partial) {
    uncertainties.push("- Parent provenance is sampled from the first recursive page.")
  }

  if (collection_context.protocol.children?.partial) {
    uncertainties.push("- Children are sampled from the first recursive page.")
  }

  if (collection_context.protocol.gallery?.partial) {
    uncertainties.push("- Gallery items are sampled from the first gallery page.")
  }

  if (collection_context.registry.match?.quality_state === "needs_info") {
    uncertainties.push("- The curated registry marks this collection as needing more information.")
  }

  if (collection_context.market.match) {
    uncertainties.push("- Market overlay collection data is public index metadata, not an on-chain provenance claim.")
  }

  return uncertainties.length > 0
    ? uncertainties
    : ["- No special uncertainties were recorded beyond normal public index limits."]
}

function describeRelatedInscription(item: RelatedInscriptionSummary): string {
  const number = item.inscription_number != null ? `#${item.inscription_number}` : "unknown number"
  const contentType = item.content_type ?? "unknown type"
  const date = item.genesis_timestamp ? ` · minted ${String(item.genesis_timestamp).slice(0, 10)}` : ""
  return `${number} · ${item.inscription_id} · ${contentType}${date}`
}

function buildSection(title: string, lines: string[]): string {
  return `${title}:\n${lines.join("\n")}`
}
