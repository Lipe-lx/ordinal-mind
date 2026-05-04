// Chronicle Synthesizer prompts — split into system + user.
// System prompt contains role + constraints (never seen by end user).
// User prompt contains only the inscription data.

import type { Chronicle, ChronicleEvent, InscriptionRarity, ProtocolRelationSet, RelatedInscriptionSummary } from "../types"
import type { ChatMessage } from "./chatTypes"
import type { ChatIntent, ChatResponseMode } from "./chatIntentRouter"
import type { WikiPage } from "../wikiTypes"

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
- Determine the response language from the latest user message only. Do not inherit the answer language from earlier turns. Default to English (United States) if the latest user message is ambiguous.
- Tone: objective, vivid, and historically aware. Avoid hype copy.
- Maximum 5 short paragraphs.
- Every fact must be backed by the provided data. If something is not in the data, do not mention it.
- Do not repeat the visible metadata as a checklist. Use identity, block, owner, and transfers only when they explain why the artifact matters.
- If collection profile data exists, lead with the collection's factual story, creators, milestones, and collector signals before zooming into this specific inscription.
- Treat trusted collection descriptions from Satflow or ord.net as high-confidence editorial context for framing the collection. Prefer Satflow when both are present, but never let editorial descriptions override on-chain facts, timestamps, provenance, transfers, or exact counts.
- Explain the relationship between this inscription and the collection: on-chain parent/provenance, curated registry match, and market overlay are separate evidence layers.
- Prefer collector-relevant meaning: distribution method, creator roles, supply/index signals, provenance mechanism, notable milestones, and what remains uncertain.
- Treat protocol-native relations as higher trust than curated registry matches.
- Parent provenance and galleries are different mechanisms. Never imply that a gallery or curated match creates an on-chain parent-child relationship.
- If a section says data is partial, sampled, or unresolved, keep that uncertainty explicit.
- Do not copy placeholder text such as "...". Inside the final_answer tags, include ONLY the final Chronicle text.

### OUTPUT FORMAT
CRITICAL: YOU MUST ONLY OUTPUT IN THIS FORMAT:
<thought>
Your internal reasoning, research evaluation, and analysis.
</thought>
<final_answer>
The final user-facing Chronicle narrative or answer.
</final_answer>

Everything outside the <final_answer> tags will be filtered out and never seen by the user.

### FINAL NUMERIC RULE
- Before giving ANY number, calculated result, total supply, price, or numeric conclusion, you MUST call a relevant tool from the available list to obtain that value.
- Mental math, guessing, or extrapolating beyond the provided or tool-fetched data is strictly prohibited.
- If the required data is missing or incomplete after research, state the uncertainty explicitly instead of inventing values.`

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
When multiple tools are needed, emit them together in the same response turn so they can run in parallel.
Do not repeat the same tool call with the same arguments.
If a transfer/sale question needs both a compact overview and exact rows, call get_timeline and get_raw_events in the same turn.
For transfer/sale questions, prefer one get_raw_events call with event_types including all needed categories, such as ["transfer","sale"], instead of separate narrow calls.
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

export function buildChatSeedPrompt(chronicle: Chronicle, wikiPage?: WikiPage | null): string {
  return `You are in an ongoing Chronicle chat.

Use the factual context below as the authoritative source of truth.
Never invent events, dates, transfers, sales, rarity details, or social signals.
If data is missing or uncertain, say so explicitly.

${wikiPage ? `[Wiki Archive Knowledge]
Title: ${wikiPage.title}
Summary: ${wikiPage.summary}
${wikiPage.sections.length > 0 ? `Archive Sections:\n${wikiPage.sections.map(s => `- ${s.heading}: ${s.body}`).join("\n")}` : ""}
` : ""}

${buildSynthesisContext(chronicle)}`
}

export function buildChatTurnPrompt(
  chronicle: Chronicle,
  history: ChatMessage[],
  userMessage: string,
  options: {
    mode: ChatResponseMode
    intent: ChatIntent
    wikiCompletenessInfo?: string
    wikiPage?: WikiPage | null
    wikiStatus?: string
  }
): string {
  const { mode, intent, wikiCompletenessInfo, wikiPage, wikiStatus } = options
  const transcript = history
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n")

  const historySection = transcript
    ? `Conversation so far:\n${transcript}`
    : "Conversation so far:\n(no prior turns)"

  return `${buildChatSeedPrompt(chronicle, wikiPage)}

${wikiStatus && wikiStatus !== "idle" ? `Current Wiki Context Status: ${wikiStatus}\n` : ""}

${historySection}

Latest user message:
${userMessage}

${buildChatPolicyBlock(mode, intent, userMessage === INITIAL_NARRATIVE_PROMPT, wikiCompletenessInfo, !!wikiPage)}`
}

function buildChatPolicyBlock(mode: ChatResponseMode, intent: ChatIntent, isInitial: boolean, wikiCompletenessInfo?: string, hasWikiContext?: boolean): string {
  if (intent === "knowledge_contribution") {
    return `Response policy:
Wiki Builder Mode:
- You detected the user has original knowledge about this collection.
- Your goal is to extract structured information naturally through conversation.
${wikiCompletenessInfo ? `\nConsolidated Wiki Context:\n${wikiCompletenessInfo}\n` : ""}
- IMPORTANT: Check the [Wiki Archive Knowledge] above before responding. If the user mentions a fact already recorded there (like the founder, launch date, etc.), acknowledge it as existing archive knowledge (e.g., "As recorded in the archive, ...") instead of attributing it as a new claim from the user.
- When the claim refers to public facts such as founder identity, launch timing, provenance, inscription relationships, or notable public milestones, verify or contextualize it with the available public tools before presenting it as established fact.
- Prefer on-chain and wiki tools first for precise facts. Use web research tools only for public historical or cultural context.
- If verification is incomplete, keep that uncertainty explicit in the visible reply and still capture the contribution as community-provided context in <wiki_extract>.
- If multiple tools are helpful, emit them in the same response turn so they can run in parallel.
- DO NOT ask questions like a form. Weave questions naturally into the conversation.
- When the user provides new information, confirm it conversationally.
- Generate a <wiki_extract> block with the structured data (hidden from user). Format:
  <wiki_extract>{"field":"founder","value":"...","confidence":"stated_by_user","verifiable":true,"collection_slug":"..."}</wiki_extract>
- Field must be one of: founder, launch_date, launch_context, origin_narrative, technical_details, notable_moments, community_culture, connections, current_status.
${hasWikiContext ? '- If the info is already in the archive, you do NOT need to generate a <wiki_extract> for it unless the user is correcting it.' : '- Always validate: "You\'re saying X, correct? That\'s valuable context for this collection\'s chronicle."'}
- If user has no Discord connected, mention gently that contributions enter review.
- Answer in the exact language of the latest user message only. Do not inherit answer language from earlier turns.
- CRITICAL TAG RULE: You MUST start your response immediately with <thought>. Do not write any text before the <thought> tag.
- Put the user-facing answer between these exact tags: <final_answer> and </final_answer>.
- Keep internal <thought> blocks brief and focused on evidence evaluation.
- The <wiki_extract> block must be OUTSIDE the <final_answer> block, placed at the very end of your response.`
  }

  if (mode === "narrative") {
    return `Response policy:
- Provide a concise collector-grade Chronicle narrative (max 5 short paragraphs).
${isInitial ? "- CRITICAL LANGUAGE RULE: This is the initial narrative generation. You MUST write the final narrative strictly in English (United States), regardless of any past chat history." : "- CRITICAL LANGUAGE RULE: Respond in the exact language of the latest user message only. Do not inherit answer language from earlier turns."}
- Keep strict factual precision and explicit uncertainty when data is partial.
- For event-level facts, prioritize tool evidence from get_raw_events/get_timeline.
- Use wiki search/context as secondary support, not as sole source for precise event claims.
- CRITICAL TAG RULE: You MUST start your response immediately with <thought>. Do not write any text before the <thought> tag.
- Put the user-visible answer between these exact tags: <final_answer> and </final_answer>.
- Keep internal <thought> blocks brief and focused on evidence evaluation.
- The text inside the tags must be complete sentences.
- Use <thought> tags for internal reasoning. Everything outside <final_answer> will be hidden.`
  }

  const intentSpecific = intent === "chronicle_query"
    ? "- Answer the latest user question directly in the first sentence.\n- For short factoid questions (who/when/where/how many), keep the reply compact: one direct answer sentence, plus one brief evidence sentence only if it helps.\n- Do not recap the full Chronicle unless explicitly requested.\n- Use extra detail only if the user asks to expand."
    : "- Keep response short and conversational (1-2 sentences)."

  return `Response policy:
${intentSpecific}
${isInitial ? "- CRITICAL LANGUAGE RULE: You MUST write the answer strictly in English (United States)." : "- Answer in the exact language of the latest user message only. Do not inherit answer language from earlier turns."}
- CRITICAL TAG RULE: You MUST start your response immediately with <thought>. Do not write any text before the <thought> tag.
- Put the user-facing answer between these exact tags: <final_answer> and </final_answer>.
- Keep internal <thought> blocks brief and focused on evidence evaluation.
- The text inside the tags must be complete sentences.
- Use <thought> tags for internal reasoning. Everything outside <final_answer> will be hidden.
- Resolve pronouns and corrections from the conversation history. If the user corrects scope, such as "I meant the parent", reinterpret the previous factual question for that target.
- For parent/child/genealogy questions, use the Parents, Children, and related protocol sections first. If the parent mint date is not present there, say it is not available in the current data instead of guessing.
- Preserve factual precision and acknowledge uncertainty when relevant.
- Prefer get_raw_events for specific factual claims and cite source references when available.
- If any tool returns partial data or empty results, explicitly flag incompleteness to the user.
- If the user asks for a recap/resumo/narrativa, then expand into a full narrative.
- If get_collection_context returns collection_size of 0 or null, do NOT retry the same call with different parameters. Instead, use web_search or deep_research to find contextual information.
- If multiple factual tools are relevant, emit all needed tool calls in the same response turn so they can run in parallel.
- Never repeat a tool call with the same arguments unless the earlier result explicitly says partial, missing, or errored.
- For transfer/sale questions, prefer a single get_raw_events call that includes all required event_types, such as ["transfer","sale"], instead of separate calls for each type.
- If you need both the compact history and the raw rows, call get_timeline and get_raw_events together in the same turn.
- CRITICAL FACT RULE: Never invent supply numbers, mint dates, or sale volumes. If a tool fails to return the exact value, say the information was not found in the available public records.`
}

export function buildSynthesisContext(chronicle: Chronicle): string {
  const { meta, events, media_context, collection_context, source_catalog, unisat_enrichment } = chronicle

  const collectionName = collection_context.presentation.full_label || collection_context.presentation.primary_label
  const collectionSlug = collection_context.market.match?.collection_slug ?? collection_context.registry.match?.slug
  const resolvedMarketCollectionName =
    collection_context.profile?.name
    ?? collection_context.presentation.primary_label
    ?? collection_context.market.match?.collection_name

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
    buildSection("Trait rarity", buildTraitRaritySection(unisat_enrichment?.rarity)),
    buildSection("Trusted collection descriptions", buildTrustedCollectionDescriptionSection(chronicle)),
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
            `Collection: ${resolvedMarketCollectionName ?? collection_context.market.match.collection_name}`,
            resolvedMarketCollectionName && resolvedMarketCollectionName !== collection_context.market.match.collection_name
              ? `Overlay label: ${collection_context.market.match.collection_name}`
              : null,
            `Slug: ${collection_context.market.match.collection_slug}`,
            `Verified: ${collection_context.market.match.verified ? "yes" : "no"}`,
            `Item name: ${collection_context.market.match.item_name ?? "unknown"}`,
            `Collection href: ${collection_context.market.match.collection_href}`,
            collection_context.socials.official_x_profiles.length > 0
              ? `Official X accounts: ${collection_context.socials.official_x_profiles.map((profile) => profile.url).join(", ")}`
              : "Official X accounts: none found",
          ].filter((line): line is string => Boolean(line))
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
    collection_context.presentation.primary_label ??
    collection_context.presentation.full_label ??
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

function buildTraitRaritySection(rarity: InscriptionRarity | null | undefined): string[] {
  if (!rarity) return ["No trait rarity breakdown found."]

  const lines = [
    `Trait count: ${rarity.traits.length}`,
    rarity.rarity_rank != null ? `Rarity rank: #${rarity.rarity_rank}` : "Rarity rank: unavailable",
    rarity.total_supply != null ? `Total supply: ${rarity.total_supply.toLocaleString("en-US")}` : "Total supply: unavailable",
    rarity.rarity_percentile != null ? `Percentile: top ${rarity.rarity_percentile}%` : "Percentile: unavailable",
  ]

  if (rarity.trait_breakdown.length === 0) {
    lines.push("No trait frequency rows found.")
    return lines
  }

  lines.push("Traits & Attributes breakdown:")
  for (const trait of rarity.trait_breakdown.slice(0, 12)) {
    const details = [
      trait.frequency != null ? `count ${trait.frequency.toLocaleString("en-US")}` : null,
      trait.frequency_pct != null ? `freq ${formatTraitFrequencyPct(trait.frequency_pct)}` : null,
    ].filter((value): value is string => Boolean(value))

    lines.push(`- ${trait.trait_type}: ${trait.value}${details.length > 0 ? ` (${details.join(" · ")})` : ""}`)
  }

  return lines
}

function buildTrustedCollectionDescriptionSection(chronicle: Chronicle): string[] {
  const preferred = chronicle.collection_context.market.preferred_description
  const satflow = chronicle.collection_context.market.satflow_description
  const ordNet = chronicle.collection_context.market.ord_net_description

  if (!preferred && !satflow && !ordNet) {
    return ["No trusted collection descriptions found."]
  }

  const lines: string[] = []
  if (preferred) {
    lines.push(`Preferred source: ${formatCollectionDescriptionSource(preferred)}`)
    lines.push(`Preferred text: ${preferred.text}`)
  }

  const alternate =
    preferred?.source === "satflow"
      ? ordNet
      : preferred?.source === "ord_net"
        ? satflow
        : satflow ?? ordNet

  if (alternate && normalizeComparableText(alternate.text) !== normalizeComparableText(preferred?.text ?? "")) {
    lines.push(`Alternate source: ${formatCollectionDescriptionSource(alternate)}`)
    lines.push(`Alternate text: ${alternate.text}`)
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

function formatCollectionDescriptionSource(
  description: NonNullable<Chronicle["collection_context"]["market"]["preferred_description"]>
): string {
  const provider = description.source === "satflow" ? "Satflow" : "ord.net"
  const target =
    description.target === "inscription_page"
      ? "inscription page"
      : "parent inscription page"
  return `${provider} ${target} (${description.source_ref})`
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function formatTraitFrequencyPct(value: number): string {
  return value < 1 ? `${value.toFixed(2)}%` : `${Math.round(value)}%`
}

function buildSection(title: string, lines: string[]): string {
  return `${title}:\n${lines.join("\n")}`
}
