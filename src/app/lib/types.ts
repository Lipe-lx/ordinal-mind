// Shared types for Ordinal Mind — used by both Worker and React app.

export type EventType =
  | "genesis"         // inscription created
  | "transfer"        // moved to another wallet
  | "sale"            // sold on a marketplace
  | "x_mention"       // post found on X via DDG scrape
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
  | "unisat_indexer"

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
  inscription_id: string
  inscription_number?: number
  content_type?: string
  content_url?: string
  genesis_block?: number
  genesis_timestamp?: string
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
    gallery: ProtocolGalleryContext | null
  }
  registry: {
    match: CuratedRegistryMatch | null
    issues: string[]
  }
  market: {
    match: MarketOverlayMatch | null
    satflow_match?: MarketOverlayMatch | null
    ord_net_match?: MarketOverlayMatch | null
  }
  profile: CollectionProfile | null
  presentation: {
    primary_label?: string
    facets: CollectionPresentationFacet[]
  }
}

export interface Chronicle {
  inscription_id: string
  meta: InscriptionMeta
  events: ChronicleEvent[]
  media_context: MediaContext
  collection_context: CollectionContext
  source_catalog: SourceCatalogItem[]
  cached_at: string
  narrative?: string                    // filled client-side by LLM
  unisat_enrichment?: UnisatEnrichment
  validation?: DataValidationResult
}

export interface ChronicleResponse extends Chronicle {
  from_cache?: boolean
}

export interface AddressResponse {
  type: "address"
  inscriptions: { id: string; number: number; content_url: string }[]
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
