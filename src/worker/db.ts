// Structured data layer backed by Cloudflare KV.
// Each KV prefix maps to a normalized "table" for future Supabase migration.
// Designed for RAG vector embeddings and MCP tool resource access.

import type {
  TraitAttribute,
  DataValidationCheck,
} from "../app/lib/types"

// --- Schema Types (future Supabase tables) ---

export interface DBInscription {
  inscription_id: string
  inscription_number: number
  sat: number
  sat_rarity: string
  charms: string[]
  content_type: string
  genesis_block: number
  genesis_timestamp: string
  owner_address: string
  collection_id: string | null
  fetched_at: string
  sources: string[]
}

export interface DBCollection {
  collection_id: string
  name: string
  supply: number
  floor_price_sats: number | null
  listed_count: number | null
  verified: boolean
  twitter: string | null
  discord: string | null
  website: string | null
  fetched_at: string
  rarity_computed_at: string | null
}

export interface DBTraits {
  inscription_id: string
  collection_id: string
  attributes: TraitAttribute[]
  rarity_score: number | null
  rarity_rank: number | null
  total_in_collection: number
  computed_at: string | null
}

export interface DBTraitFrequencies {
  collection_id: string
  frequencies: Record<string, Record<string, number>>
  total_items: number
  computed_at: string
}

export interface DBMarketEvent {
  collection_id: string
  inscription_id: string
  event: "Sold" | "Listed" | "Delisted"
  price_sats: number
  from_address: string
  to_address: string
  timestamp: string
  attributes: TraitAttribute[]
}

export interface DBValidation {
  inscription_id: string
  confidence: "high" | "medium" | "low"
  checks: DataValidationCheck[]
  validated_at: string
}

// --- TTL Constants ---

const TTL = {
  inscriptions: 60 * 60 * 24,         // 24h — owner can change
  collections: 60 * 60 * 24,          // 24h — floor/listed changes
  traits: 60 * 60 * 24 * 7,           // 7d — traits are immutable once minted
  trait_frequencies: 60 * 60 * 24,    // 24h — new mints can shift frequencies
  market_events: 60 * 60 * 24 * 30,   // 30d — historical, immutable
  validations: 60 * 60 * 24,          // 24h — re-validate periodically
} as const

// --- KV Key Builders ---

const keys = {
  inscription: (id: string) => `inscriptions:${id}`,
  collection: (id: string) => `collections:${id}`,
  traits: (inscriptionId: string) => `traits:${inscriptionId}`,
  traitFrequencies: (collectionId: string) => `trait_freq:${collectionId}`,
  marketEvents: (collectionId: string) => `market_events:${collectionId}`,
  validation: (inscriptionId: string) => `validations:${inscriptionId}`,
}

// --- Generic read/write helpers ---

async function dbGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function dbPut(kv: KVNamespace, key: string, data: unknown, ttl: number): Promise<void> {
  await kv.put(key, JSON.stringify(data), { expirationTtl: ttl })
}

// --- Public API ---

export const db = {
  // --- Inscriptions ---
  async getInscription(kv: KVNamespace, id: string): Promise<DBInscription | null> {
    return dbGet<DBInscription>(kv, keys.inscription(id))
  },
  async putInscription(kv: KVNamespace, data: DBInscription): Promise<void> {
    await dbPut(kv, keys.inscription(data.inscription_id), data, TTL.inscriptions)
  },

  // --- Collections ---
  async getCollection(kv: KVNamespace, id: string): Promise<DBCollection | null> {
    return dbGet<DBCollection>(kv, keys.collection(id))
  },
  async putCollection(kv: KVNamespace, data: DBCollection): Promise<void> {
    await dbPut(kv, keys.collection(data.collection_id), data, TTL.collections)
  },

  // --- Traits (per inscription) ---
  async getTraits(kv: KVNamespace, inscriptionId: string): Promise<DBTraits | null> {
    return dbGet<DBTraits>(kv, keys.traits(inscriptionId))
  },
  async putTraits(kv: KVNamespace, data: DBTraits): Promise<void> {
    await dbPut(kv, keys.traits(data.inscription_id), data, TTL.traits)
  },

  // --- Trait Frequencies (per collection) ---
  async getTraitFrequencies(kv: KVNamespace, collectionId: string): Promise<DBTraitFrequencies | null> {
    return dbGet<DBTraitFrequencies>(kv, keys.traitFrequencies(collectionId))
  },
  async putTraitFrequencies(kv: KVNamespace, data: DBTraitFrequencies): Promise<void> {
    await dbPut(kv, keys.traitFrequencies(data.collection_id), data, TTL.trait_frequencies)
  },

  // --- Market Events (per collection, append-style) ---
  async getMarketEvents(kv: KVNamespace, collectionId: string): Promise<DBMarketEvent[] | null> {
    return dbGet<DBMarketEvent[]>(kv, keys.marketEvents(collectionId))
  },
  async putMarketEvents(kv: KVNamespace, collectionId: string, events: DBMarketEvent[]): Promise<void> {
    await dbPut(kv, keys.marketEvents(collectionId), events, TTL.market_events)
  },

  // --- Validations ---
  async getValidation(kv: KVNamespace, inscriptionId: string): Promise<DBValidation | null> {
    return dbGet<DBValidation>(kv, keys.validation(inscriptionId))
  },
  async putValidation(kv: KVNamespace, data: DBValidation): Promise<void> {
    await dbPut(kv, keys.validation(data.inscription_id), data, TTL.validations)
  },
}
