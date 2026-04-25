// Ordinals.com agent — fetches inscription metadata, sat rarity, and location data.
// Base: https://ordinals.com
//
// Provides: inscription ID, number, sat, content type, genesis block/timestamp/fee,
// owner address, collection (parent), recursive refs, satpoint, and current output.
//
// The satpoint and output fields are critical for forward UTXO tracking:
// - satpoint: "txid:vout:offset" — exact location of the inscribed sat
// - output: "txid:vout" — current UTXO containing the inscription

import { Buffer } from "node:buffer"
import cbor from "cbor"

import type { InscriptionMeta } from "../../app/lib/types"

interface OrdinalsInscriptionResponse {
  id: string
  number: number
  sat?: number
  content_type: string
  height: number
  timestamp?: number
  fee: number
  address?: string
  parent?: string
  references?: string[]
  value?: number
  output?: string       // "txid:vout" — current UTXO
  satpoint?: string     // "txid:vout:offset" — exact sat location
}

interface OrdinalsSatResponse {
  rarity?: string
}

interface OrdinalsMetadataOptions {
  debug?: boolean
  requestId?: string
}

export const fetchOrdinals = {
  async inscription(id: string): Promise<InscriptionMeta> {
    const res = await fetch(`https://ordinals.com/r/inscription/${id}`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`ordinals.com: inscription ${id} not found (${res.status})`)

    const data = await res.json() as OrdinalsInscriptionResponse
    
    // Fetch sat rarity if we have a sat number
    let rarity: InscriptionMeta["sat_rarity"] = "common"
    if (data.sat != null) {
      const satRes = await fetch(`https://ordinals.com/r/sat/${data.sat}`, {
        headers: { Accept: "application/json" },
      })
      if (satRes.ok) {
        const satData = await satRes.json() as OrdinalsSatResponse
        if (satData.rarity) {
          rarity = normalizeSatRarity(satData.rarity as string)
        }
      }
    }

    // Extract genesis txid from inscription ID (format: "txidi0")
    const genesisTxid = id.split("i")[0]

    return {
      inscription_id: data.id,
      inscription_number: data.number,
      sat: data.sat ?? 0,
      sat_rarity: rarity,
      content_type: data.content_type,
      content_url: `https://ordinals.com/content/${data.id}`,
      genesis_block: data.height,
      genesis_timestamp: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date(0).toISOString(),
      genesis_fee: data.fee,
      owner_address: data.address ?? "?",
      // Forward tracking fields
      satpoint: data.satpoint,
      genesis_txid: genesisTxid,
      genesis_vout: 0,  // FIFO simplified: inscriptions are born on the first sat of the first output
      current_output: data.output,
      collection: data.parent ? { parent_inscription_id: data.parent } : undefined,
      recursive_refs: data.references ?? undefined,
    }
  },

  async metadata(id: string, options?: OrdinalsMetadataOptions): Promise<Record<string, string> | null> {
    try {
      const res = await fetch(`https://ordinals.com/r/metadata/${id}`, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        metadataDiag(options, id, "metadata_http_non_ok", { status: res.status })
        return null
      }

      const payload = await res.json() as unknown
      metadataDiag(options, id, "metadata_payload_received", {
        payload_type: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
      })

      // Some inscriptions expose metadata as JSON directly.
      const directTraits = toTraitRecord(extractTraits(payload))
      if (directTraits) {
        metadataDiag(options, id, "metadata_direct_traits", {
          trait_count: Object.keys(directTraits).length,
        })
        return directTraits
      }

      // Most ordinals metadata responses are CBOR hex payloads.
      const hexStr = extractHexPayload(payload)
      if (!hexStr) {
        metadataDiag(options, id, "metadata_no_hex_payload")
        return null
      }

      const decoded = cbor.decode(Buffer.from(hexStr, "hex"))
      const decodedTraits = toTraitRecord(extractTraits(decoded))
      metadataDiag(options, id, "metadata_cbor_decoded", {
        hex_size: hexStr.length,
        trait_count: decodedTraits ? Object.keys(decodedTraits).length : 0,
      })
      return decodedTraits
    } catch (e) {
      console.error(`[Ordinals] Failed to decode CBOR for ${id}:`, e)
      metadataDiag(options, id, "metadata_decode_error", {
        error: e instanceof Error ? e.message : String(e),
      })
      return null
    }
  }
}

function metadataDiag(
  options: OrdinalsMetadataOptions | undefined,
  inscriptionId: string,
  event: string,
  data: Record<string, unknown> = {}
): void {
  if (!options?.debug) return
  console.info(`[OrdinalsMetadataDiag] ${JSON.stringify({
    at: new Date().toISOString(),
    request_id: options.requestId ?? null,
    inscription_id: inscriptionId,
    event,
    ...data,
  })}`)
}

const RESERVED_METADATA_KEYS = new Set([
  "name",
  "description",
  "image",
  "animation_url",
  "external_url",
  "background_color",
  "compiler",
])

function extractHexPayload(payload: unknown): string | null {
  if (typeof payload === "string") {
    return normalizeHex(payload)
  }

  for (const key of ["hex", "data", "metadata", "value"]) {
    const candidate = getField(payload, key)
    if (typeof candidate === "string") {
      const normalized = normalizeHex(candidate)
      if (normalized) return normalized
    }
  }

  return null
}

function normalizeHex(value: string): string | null {
  const cleaned = value.trim().replace(/^0x/i, "")
  if (!/^[a-f0-9]+$/i.test(cleaned)) return null
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return null
  return cleaned
}

function toTraitRecord(
  traits: Array<{ trait_type: string; value: string }>
): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const trait of traits) {
    if (!trait.trait_type) continue
    out[trait.trait_type] = trait.value
  }

  return Object.keys(out).length > 0 ? out : null
}

function extractTraits(payload: unknown): Array<{ trait_type: string; value: string }> {
  // Common NFT-like containers
  for (const key of ["attributes", "traits"]) {
    const fromArray = parseTraitArray(getField(payload, key))
    if (fromArray.length > 0) return fromArray
  }

  // Object containers (e.g. properties: { Background: "Blue" })
  for (const key of ["properties", "attributes", "traits"]) {
    const fromMap = parseTraitMap(getField(payload, key))
    if (fromMap.length > 0) return fromMap
  }

  // Fallback: top-level map of traits
  return parseTraitMap(payload, true)
}

function parseTraitArray(input: unknown): Array<{ trait_type: string; value: string }> {
  if (!Array.isArray(input)) return []

  const out: Array<{ trait_type: string; value: string }> = []
  for (const item of input) {
    const rawType = getField(item, "trait_type")
      ?? getField(item, "traitType")
      ?? getField(item, "key")
      ?? getField(item, "type")
      ?? getField(item, "name")
    const rawValue = getField(item, "value")
      ?? getField(item, "val")

    if (typeof rawType !== "string" || rawValue === undefined || rawValue === null) continue
    out.push({
      trait_type: rawType.trim(),
      value: String(rawValue),
    })
  }

  return out.filter((t) => t.trait_type.length > 0)
}

function parseTraitMap(
  input: unknown,
  skipReservedKeys = false
): Array<{ trait_type: string; value: string }> {
  const out: Array<{ trait_type: string; value: string }> = []

  for (const [rawKey, rawValue] of entriesOf(input)) {
    const key = rawKey.trim()
    if (!key) continue
    if (skipReservedKeys && RESERVED_METADATA_KEYS.has(key.toLowerCase())) continue

    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      out.push({ trait_type: key, value: String(rawValue) })
    }
  }

  return out
}

function getField(source: unknown, key: string): unknown {
  if (!source) return undefined
  if (source instanceof Map) return source.get(key)
  if (typeof source === "object" && key in source) {
    return (source as Record<string, unknown>)[key]
  }
  return undefined
}

function entriesOf(source: unknown): Array<[string, unknown]> {
  if (!source) return []
  if (source instanceof Map) {
    return [...source.entries()]
      .filter(([k]) => typeof k === "string") as Array<[string, unknown]>
  }
  if (typeof source === "object") {
    return Object.entries(source as Record<string, unknown>)
  }
  return []
}

function normalizeSatRarity(raw: string): InscriptionMeta["sat_rarity"] {
  const map: Record<string, InscriptionMeta["sat_rarity"]> = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    epic: "epic",
    legendary: "legendary",
    mythic: "mythic",
  }
  return map[raw?.toLowerCase()] ?? "common"
}
