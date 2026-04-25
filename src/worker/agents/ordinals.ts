// Ordinals.com agent — fetches inscription metadata, sat rarity, and location data.
// Base: https://ordinals.com
//
// Provides: inscription ID, number, sat, content type, genesis block/timestamp/fee,
// owner address, collection (parent), recursive refs, satpoint, and current output.
//
// The satpoint and output fields are critical for forward UTXO tracking:
// - satpoint: "txid:vout:offset" — exact location of the inscribed sat
// - output: "txid:vout" — current UTXO containing the inscription

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
  }
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
