// Shared types for Ordinal Mind — used by both Worker and React app.

export type EventType =
  | "genesis"         // inscription created
  | "transfer"        // moved to another wallet
  | "sale"            // sold on a marketplace
  | "social_mention"  // post or community reference found on public social sources
  | "collection_link" // belongs to a collection (parent inscription)
  | "recursive_ref"   // references another inscription
  | "sat_context"     // sat rarity data
  | "trait_context"   // trait-based rarity data from CBOR + market overlays

export type SatRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic"

export type SourceTrustLevel =
  | "canonical_onchain"
  | "official_index"
  | "curated_public_registry"
  | "curated_public_research"
  | "market_overlay"
  | "bitcoin_indexer"
  | "public_social"
  | "unisat_indexer"

export type SocialPlatform = "x" | "google_trends"
export type SocialSignalProvider = "google_trends"
export type SocialMatchType =
  | "collection_only"
  | "item_plus_collection"
  | "item_only"
  | "inscription_number"
  | "inscription_id"
export type SocialScope = "inscription_level" | "collection_level" | "mixed"
export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed" | "insufficient_data"
export type CollectorSignalConfidence = "low" | "medium" | "high"

export type VisionTransport = "public_url" | "inline_data" | "unsupported"

export type MediaKind =
  | "image"
  | "audio"
  | "video"
  | "html"
  | "svg"
  | "text"
  | "model"
  | "document"
  | "unknown"

export interface ChronicleEvent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any
  id: string
  timestamp: string                    // ISO8601 derived from BTC block
  block_height: number
  event_type: EventType
  source: {
    type: "onchain" | "web"
    ref: string                        // txid or URL
  }
  description: string                  // short factual phrase
  metadata: Record<string, unknown>
}

export interface SocialMentionEngagement {
  likes?: number
  replies?: number
  reposts?: number
  quotes?: number
}

export interface SocialMention {
  platform: SocialPlatform
  provider: SocialSignalProvider
  canonical_url: string
  title: string
  excerpt: string
  text: string
  author_handle?: string
  author_url?: string
  published_at: string
  discovered_at: string
  scope: SocialScope
  match_type: SocialMatchType
  provider_confidence: number
  engagement?: SocialMentionEngagement
}

export interface InscriptionMeta {
  inscription_id: string               // hex hash with i0 suffix
  inscription_number: number
  sat: number
  sat_rarity: SatRarity
  content_type: string
  content_url: string
  genesis_block: number
  genesis_timestamp: string
  genesis_fee: number
  owner_address: string
  genesis_owner_address?: string
  // Forward tracking fields
  satpoint?: string                    // "txid:vout:offset" — exact sat location
  genesis_txid: string                 // txid of the reveal transaction
  genesis_vout: number                 // vout where inscription was born (FIFO simplified: 0)
  current_output?: string              // "txid:vout" — current UTXO location
  collection?: {
    parent_inscription_id: string
    name?: string
  }
  recursive_refs?: string[]            // other inscription IDs referenced
  // UniSat enrichment
  charms?: string[]                    // e.g., ["vintage", "cursed", "nineball"]
}

export interface SourceCatalogItem {
  source_type: string
  url_or_ref: string
  trust_level: SourceTrustLevel
  fetched_at: string
  partial: boolean
  detail?: string
}

export interface MediaContext {
  kind: MediaKind
  content_type: string
  content_url: string
  preview_url: string
  vision_eligible: boolean
  vision_transport: VisionTransport
  fallback_reason?: string
}

export interface RelatedInscriptionSummary {
  item?: unknown
  inscription_id: string
  inscription_number: number | null
  content_type?: string
  content_url?: string
  genesis_block?: number
  genesis_timestamp?: string | number
  related_to_ids?: string[]
}

export interface ProtocolRelationSet {
  items: RelatedInscriptionSummary[]
  total_count: number
  more: boolean
  source_ref: string
  partial: boolean
}

export interface ProtocolGalleryContext {
  gallery_id: string
  items: RelatedInscriptionSummary[]
  total_count: number
  more: boolean
  source_ref: string
  partial: boolean
}

export interface CuratedRegistryMatch {
  matched_collection: string
  match_type: "parent" | "gallery"
  slug: string
  registry_ids: string[]
  quality_state: "verified" | "needs_info"
  issues: string[]
  source_ref: string
}

export interface CollectionPresentationFacet {
  label: string
  value: string
  tone: "canonical" | "curated" | "overlay" | "partial"
  detail?: string
}

export type MarketRaritySource = "satflow" | "ord_net"

export interface MarketRarityOverlay {
  source: MarketRaritySource
  rank: number
  supply?: number
  source_ref?: string
  traits: Array<{ key: string, value: string, tokenCount: number }>
}

export interface CollectionDescriptionEvidence {
  source: "satflow" | "ord_net"
  source_ref: string
  text: string
  target: "inscription_page" | "parent_inscription_page"
}

export interface MarketOverlayMatch {
  collection_slug: string
  collection_name: string
  collection_href: string
  item_name?: string
  verified: boolean
  owner_address?: string
  source_ref: string
  rarity_overlay?: MarketRarityOverlay
}

export interface CollectionMarketStats {
  source_ref: string
  floor_price?: string
  change_7d?: string
  volume_7d?: string
  supply?: string
  listed?: string
  market_cap?: string
}

export interface CollectionProfileFact {
  label: string
  value: string
  source_ref: string
}

export interface CollectionProfile {
  name: string
  slug: string
  summary?: string
  creators: CollectionProfileFact[]
  milestones: CollectionProfileFact[]
  collector_signals: CollectionProfileFact[]
  market_stats?: CollectionMarketStats
  sources: SourceCatalogItem[]
}

export interface CollectionContext {
  protocol: {
    parents: ProtocolRelationSet | null
    children: ProtocolRelationSet | null
    grandchildren: ProtocolRelationSet | null
    gallery: ProtocolGalleryContext | null
    grandparents: ProtocolRelationSet | null
    greatGrandparents: ProtocolRelationSet | null
  }
  registry: {
    match: CuratedRegistryMatch | null
    issues: string[]
  }
  market: {
    match: MarketOverlayMatch | null
    satflow_match: MarketOverlayMatch | null
    ord_net_match: MarketOverlayMatch | null
    preferred_description: CollectionDescriptionEvidence | null
    satflow_description: CollectionDescriptionEvidence | null
    ord_net_description: CollectionDescriptionEvidence | null
  }
  profile: CollectionProfile | null
  socials: {
    official_x_profiles: Array<{
      url: string
      source_ref: string
    }>
  }
  presentation: {
    primary_label?: string
    item_label?: string
    full_label?: string
    facets: CollectionPresentationFacet[]
  }
}

export interface Chronicle {
  inscription_id: string
  meta: InscriptionMeta
  events: ChronicleEvent[]
  collector_signals: CollectorSignals
  media_context: MediaContext
  collection_context: CollectionContext
  source_catalog: SourceCatalogItem[]
  cached_at: string
  web_research?: WebResearchContext
  unisat_enrichment?: UnisatEnrichment
  validation?: DataValidationResult
  debug_info?: ChronicleDebugInfo
}

export interface WebResearchItem {
  title: string
  url: string
  snippet: string
  content?: string
  source: string // e.g., "searxng"
}

export interface WebResearchContext {
  query: string
  results: WebResearchItem[]
  fetched_at: string
}

export interface ChronicleResponse extends Chronicle {
  from_cache?: boolean
}

export interface ChronicleDebugInfo {
  mention_providers?: Partial<Record<SocialSignalProvider, MentionProviderDebug>>
}

export interface MentionProviderAttempt {
  target?: string
  query: string
  outcome:
    | "query_completed"
    | "non_ok"
    | "fetch_failed"
    | "transport_unavailable"
    | "timeout"
    | "unsupported"
    | "skipped"
  status?: number
  result_count?: number
  detail?: string
}

export interface MentionProviderDebug {
  provider: SocialSignalProvider
  collection_name?: string
  item_name?: string
  official_x_urls?: string[]
  candidate_handles?: string[]
  queries: string[]
  attempts: MentionProviderAttempt[]
  notes: string[]
}

export interface CollectorSignalsTopEvidence {
  platform: SocialPlatform
  provider: SocialSignalProvider
  url: string
  title: string
  excerpt: string
  author_handle?: string
  published_at: string
  scope: SocialScope
  match_type: SocialMatchType
}

export interface CollectorSignalsWindow {
  evidence_count: number
  provider_count: number
  attention_score: number
  sentiment_label: SentimentLabel
}

export interface CollectorSignals {
  attention_score: number
  sentiment_label: SentimentLabel
  confidence: CollectorSignalConfidence
  evidence_count: number
  provider_breakdown: Record<SocialSignalProvider, number>
  scope_breakdown: {
    inscription_level: number
    collection_level: number
    mixed: number
    dominant_scope: SocialScope | "none"
  }
  top_evidence: CollectorSignalsTopEvidence[]
  windows: {
    current_7d: CollectorSignalsWindow
    context_30d: CollectorSignalsWindow
  }
}



export interface AddressInscriptionItem {
  id: string
  number: number
  content_type: string
  content_url: string
}

export interface AddressResponse {
  type: "address"
  address: string
  inscriptions: AddressInscriptionItem[]
  total: number
  cursor: number
}

export interface ErrorResponse {
  error: string
}

export type ApiResponse = ChronicleResponse | AddressResponse | ErrorResponse

// --- Scan Progress (SSE streaming) ---

export interface ScanProgress {
  phase: "metadata" | "transfers" | "mentions" | "unisat" | "complete"
  step: number
  total?: number
  description: string
}

// --- UniSat Enrichment Types ---

export interface TraitAttribute {
  trait_type: string
  value: string
}

export interface TraitRarityBreakdown {
  trait_type: string
  value: string
  frequency?: number              // how many items in collection have this value
  frequency_pct?: number          // percentage (0-100)
  rarity_contribution?: number    // this trait's contribution to the total score
}

export interface InscriptionRarity {
  rarity_score: number | null
  rarity_rank: number | null
  rarity_percentile: number | null // e.g., 1.6 means top 1.6%
  total_supply: number | null
  traits: TraitAttribute[]
  trait_breakdown: TraitRarityBreakdown[]
  computed_at: string
}

export interface UnisatEnrichment {
  inscription_info: {
    charms: string[]
    sat: number
    metaprotocol: string | null
    content_length: number
  } | null
  collection_context: {
    collection_id: string
    collection_name: string
    floor_price_sats: number | null
    listed_count: number | null
    total_supply: number | null
    verified: boolean
  } | null
  rarity: InscriptionRarity | null
  market_info: {
    listed: boolean
    price_sats: number | null
    item_name: string | null
  } | null
  source_catalog: SourceCatalogItem[]
}

export interface DataValidationCheck {
  field: string
  sources_agree: boolean
  values: { source: string; value: string }[]
  note?: string
}

export interface DataValidationResult {
  confidence: "high" | "medium" | "low"
  checks: DataValidationCheck[]
  validated_at: string
}
// wiki/consolidateTypes.ts — Pillar 3 Canonical Consensus Types

export type ContributionStatus = "canonical" | "draft" | "disputed"

export interface ConsensusContribution {
  value: string
  contributor_id: string | null
  og_tier: string
  weight: number
  created_at: string
}

export interface ConsolidatedField {
  field: string
  canonical_value: string | null
  status: ContributionStatus
  contributions: ConsensusContribution[]
  resolved_by_tier: string
}

export interface FactualData {
  supply: number | null
  first_seen: string | null
  last_seen: string | null
}

export interface ConsolidatedCollection {
  collection_slug: string
  sample_inscription_id: string | null
  completeness: {
    filled: number
    total: number
    score: number
  }
  confidence: number // Weighted average of tier confidence
  factual: FactualData | null // Provided by the frontend merging with Chronicle
  narrative: Record<string, ConsolidatedField>
  sources: Array<{
    contributor_id: string | null
    og_tier: string
    field: string
    created_at: string
  }>
  gaps: string[]
}

export type WikiGraphNodeKind =
  | "collection"
  | "field"
  | "claim"
  | "wiki_page"
  | "source_event"
  | "external_ref"

export type WikiGraphEdgeKind =
  | "has_field"
  | "has_claim"
  | "belongs_to_collection"
  | "cites_event"
  | "links_to"

export type WikiGraphStatus =
  | "canonical"
  | "draft"
  | "disputed"
  | "supporting"
  | "partial"
  | "neutral"

export interface WikiGraphNode {
  id: string
  kind: WikiGraphNodeKind
  label: string
  status: WikiGraphStatus
  parent_id?: string | null
  href?: string | null
  description?: string | null
  metadata: Record<string, unknown>
}

export interface WikiGraphEdge {
  id: string
  kind: WikiGraphEdgeKind
  source: string
  target: string
  status: WikiGraphStatus
  label?: string | null
  metadata: Record<string, unknown>
}

export interface WikiGraphCounts {
  nodes: number
  edges: number
  fields: number
  claims: number
  wiki_pages: number
  source_events: number
  external_refs: number
}

export interface WikiGraphPayload {
  collection_slug: string
  focus_node_id: string | null
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
  counts: WikiGraphCounts
  warnings: string[]
  generated_at: string
  partial: boolean
}
