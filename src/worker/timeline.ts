// Timeline builder — deterministic merge and chronological sort of all events.
// Same input + same upstream data = same output.

import type { ChronicleEvent, InscriptionMeta, UnisatEnrichment } from "../app/lib/types"
import type { SocialMention } from "../app/lib/types"
import type { EnrichedTransfer } from "./agents/mempool"

let _seq = 0
const uid = () => `ev_${Date.now()}_${_seq++}`

export function buildTimeline(
  meta: InscriptionMeta,
  transfers: EnrichedTransfer[],
  socialMentions: SocialMention[],
  unisatEnrichment?: UnisatEnrichment
): ChronicleEvent[] {
  const events: ChronicleEvent[] = []

  // Genesis event — always present
  events.push({
    id: uid(),
    timestamp: meta.genesis_timestamp,
    block_height: meta.genesis_block,
    event_type: "genesis",
    source: { type: "onchain", ref: meta.genesis_txid },
    description: `Inscribed at block ${meta.genesis_block} · sat #${meta.sat?.toLocaleString("en-US") ?? "0"}`,
    metadata: {
      sat: meta.sat,
      content_type: meta.content_type,
      genesis_fee: meta.genesis_fee,
      address: meta.genesis_owner_address ?? meta.owner_address,
    },
  })

  // Sat rarity context (only if non-common)
  if (meta.sat_rarity !== "common") {
    const charms = meta.charms ?? (unisatEnrichment?.inscription_info?.charms ?? [])
    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "sat_context",
      source: { type: "onchain", ref: `sat:${meta.sat}` },
      description: `Sat rarity: ${meta.sat_rarity}${charms.length > 0 ? ` · Charms: ${charms.join(", ")}` : ""}`,
      metadata: { sat_rarity: meta.sat_rarity, charms },
    })
  }

  if (unisatEnrichment?.rarity) {
    const r = unisatEnrichment.rarity
    const traitCount = r.traits.length

    let desc = `${traitCount} trait${traitCount !== 1 ? "s" : ""} detected`
    if (r.rarity_rank != null && r.total_supply != null) {
      desc += ` · rarity rank #${r.rarity_rank} of ${r.total_supply.toLocaleString("en-US")}`
      if (r.rarity_percentile != null) {
        desc += ` (top ${r.rarity_percentile}%)`
      }
    }

    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "trait_context",
      source: { type: "web", ref: "ordinals.com" },
      description: desc,
      metadata: {
        rarity_rank: r.rarity_rank,
        rarity_score: r.rarity_score,
        rarity_percentile: r.rarity_percentile,
        total_supply: r.total_supply,
        trait_count: traitCount,
      },
    })
  }

  // Collection link
  if (meta.collection) {
    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "collection_link",
      source: { type: "onchain", ref: meta.collection.parent_inscription_id },
      description: `Part of collection: ${meta.collection.name ?? meta.collection.parent_inscription_id.substring(0, 12) + "..."}`,
      metadata: meta.collection,
    })
  }

  // Recursive references
  const refs = meta.recursive_refs ?? []
  for (const ref of refs) {
    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "recursive_ref",
      source: { type: "onchain", ref },
      description: `Recursively references inscription ${ref.substring(0, 12)}...`,
      metadata: { referenced_id: ref },
    })
  }

  // Transfers and sales — using forward-tracked data with real price detection
  for (const t of transfers) {
    events.push({
      id: uid(),
      timestamp: t.confirmed_at ?? new Date(0).toISOString(),
      block_height: t.block_height,
      event_type: t.is_sale ? "sale" : "transfer",
      source: { type: "onchain", ref: t.tx_id },
      description: t.is_sale
        ? `Sold for ${t.value ? (t.value / 1e8).toFixed(8) : "—"} BTC · ${truncAddr(t.from_address)} → ${truncAddr(t.to_address)}`
        : `Transferred · ${truncAddr(t.from_address)} → ${truncAddr(t.to_address)}`,
      metadata: {
        from: t.from_address,
        to: t.to_address,
        sale_price_sats: t.is_sale ? t.value : undefined,
        postage_sats: t.postage_value,
        is_sale: t.is_sale,
        is_heuristic: t.is_sale, // signals price was detected by on-chain heuristic
        inputs: t.input_count,
        outputs: t.output_count,
      },
    })
  }

  // Social mentions
  for (const mention of socialMentions) {
    events.push({
      id: uid(),
      timestamp: mention.published_at,
      block_height: 0,
      event_type: "social_mention",
      source: { type: "web", ref: mention.canonical_url },
      description: `${platformLabel(mention.platform)} · ${mention.title ? mention.title.substring(0, 100) : "Collector signal found"}`,
      metadata: {
        platform: mention.platform,
        scope: mention.scope,
        match_type: mention.match_type,
        canonical_url: mention.canonical_url,
        excerpt: mention.excerpt,
        author_handle: mention.author_handle,
        author_url: mention.author_url,
        published_at: mention.published_at,
        discovered_at: mention.discovered_at,
        provider_confidence: mention.provider_confidence,
        engagement: mention.engagement,
      },
    })
  }

  // Chronological sort — events without a real timestamp go to the end
  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    if (ta === 0 && tb === 0) return 0
    if (ta === 0) return 1
    if (tb === 0) return -1
    return ta - tb
  })

  return events
}

const truncAddr = (addr: string) =>
  addr && addr !== "?"
    ? `${addr.substring(0, 8)}…${addr.substring(addr.length - 6)}`
    : "?"

function platformLabel(platform: SocialMention["platform"]): string {
  switch (platform) {
    case "nostr":
      return "Nostr"
    case "x":
      return "X"
    case "google_trends":
      return "Google Trends"
    default:
      return "Social"
  }
}
