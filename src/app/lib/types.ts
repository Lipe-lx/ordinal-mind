// Shared types for Ordinal Mind — used by both Worker and React app.

export type EventType =
  | "genesis"         // inscription created
  | "transfer"        // moved to another wallet
  | "sale"            // sold on a marketplace
  | "x_mention"       // post found on X via DDG scrape
  | "collection_link" // belongs to a collection (parent inscription)
  | "recursive_ref"   // references another inscription
  | "sat_context"     // sat rarity data

export type SatRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic"

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
}

export interface Chronicle {
  inscription_id: string
  meta: InscriptionMeta
  events: ChronicleEvent[]
  cached_at: string
  narrative?: string                    // filled client-side by LLM
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
  phase: "metadata" | "transfers" | "mentions" | "complete"
  step: number
  total?: number
  description: string
}
