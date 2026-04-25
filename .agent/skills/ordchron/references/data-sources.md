# Data Sources — Ordinal Mind

Todos os endpoints são gratuitos e não exigem API key. A arquitetura atual utiliza `ordinals.com` como fonte primária para metadados e `mempool.space` como indexador reverso para histórico de transferências (rastreador UTXO).

---

## Agent 1 — Ordinals.com (src/worker/agents/ordinals.ts)

Base: `https://ordinals.com`

Fornece metadados brutos completos: sat, fees de gênesis, data de inscrição, conteúdo, collection (parent), sat rarity e o UTXO atual (`last_transfer`).

```typescript
// src/worker/agents/ordinals.ts
import type { InscriptionMeta } from "../../app/lib/types"

export const fetchOrdinals = {
  async inscription(id: string): Promise<InscriptionMeta> {
    const res = await fetch(`https://ordinals.com/r/inscription/${id}`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`ordinals.com: inscription ${id} not found (${res.status})`)

    const data = await res.json() as any
    
    // Fetch sat rarity if we have a sat number
    let rarity: InscriptionMeta["sat_rarity"] = "common"
    if (data.sat != null) {
      const satRes = await fetch(`https://ordinals.com/r/sat/${data.sat}`, {
        headers: { Accept: "application/json" },
      })
      if (satRes.ok) {
        const satData = await satRes.json() as any
        if (satData.rarity) {
          rarity = normalizeSatRarity(satData.rarity)
        }
      }
    }

    const currentTxId = data.output ? data.output.split(':')[0] : undefined

    return {
      inscription_id: data.id,
      inscription_number: data.number,
      sat: data.sat,
      sat_rarity: rarity,
      content_type: data.content_type,
      content_url: `https://ordinals.com/content/${data.id}`,
      genesis_block: data.height,
      genesis_timestamp: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date(0).toISOString(),
      genesis_fee: data.fee,
      owner_address: data.address ?? "?",
      collection: data.parent ? { parent_inscription_id: data.parent } : undefined,
      recursive_refs: data.references ?? undefined,
      last_transfer: currentTxId ? {
        tx_id: currentTxId,
        block_height: 0,
        timestamp: new Date().toISOString(),
        value: data.value ?? 0,
        to_address: data.address ?? "?"
      } : undefined
    }
  }
}

function normalizeSatRarity(raw: string): InscriptionMeta["sat_rarity"] {
  const map: Record<string, InscriptionMeta["sat_rarity"]> = {
    common: "common", uncommon: "uncommon", rare: "rare",
    epic: "epic", legendary: "legendary", mythic: "mythic",
  }
  return map[raw?.toLowerCase()] ?? "common"
}
```

---

## Agent 2 — Mempool.space (src/worker/agents/mempool.ts)

Base: `https://mempool.space/api`

Usado como indexador nativo de bloco e **rastreador reverso de transferências** (UTXO crawler). Como não dependemos mais de indexadores pagos, viajamos "para trás" nos UTXOs (dos `vin` da transação atual até encontrar a transação Gênesis).

```typescript
// src/worker/agents/mempool.ts
interface MempoolTx {
  txid: string
  status: {
    confirmed: boolean
    block_height: number
    block_time: number // unix seconds
  }
  fee: number
  vin: { txid: string; vout: number; prevout?: { scriptpubkey_address?: string; value: number } }[]
  vout: { scriptpubkey_address?: string; value: number }[]
}

export interface EnrichedTransfer {
  tx_id: string
  from_address: string
  to_address: string
  value?: number
  confirmed_at: string | null
  block_height: number
  [key: string]: unknown
}

export const fetchMempool = {
  async tx(txid: string): Promise<MempoolTx | null> {
    const res = await fetch(`https://mempool.space/api/tx/${txid}`)
    if (!res.ok) return null
    return (await res.json()) as MempoolTx
  },

  // Traces UTXO history backward from currentTxId to genesisTxId
  async traceTransfers(
    currentTxid: string,
    genesisTxid: string,
    limit: number = 20
  ): Promise<EnrichedTransfer[]> {
    const transfers: EnrichedTransfer[] = []
    let txid = currentTxid
    let depth = 0

    while (txid && txid !== genesisTxid && depth < limit) {
      const tx = await this.tx(txid)
      if (!tx) break

      const fromAddress = tx.vin?.[0]?.prevout?.scriptpubkey_address ?? "Unknown"
      transfers.push({
        tx_id: tx.txid,
        from_address: fromAddress,
        to_address: "?", // we show 'from' as standard in the UTXO reverse lookup
        value: tx.vout?.[0]?.value ?? 0,
        confirmed_at: tx.status.block_time ? new Date(tx.status.block_time * 1000).toISOString() : null,
        block_height: tx.status.block_height ?? 0,
      })

      txid = tx.vin?.[0]?.txid ?? ""
      depth++
    }

    return transfers
  }
}
```

---

## Agent 3 — X Mentions via DDG Scrape (src/worker/agents/xsearch.ts)

Estratégia: DuckDuckGo HTML (`html.duckduckgo.com`) com query `site:x.com "inscription {id}"`.
Usa `HTMLRewriter` nativo do Cloudflare — sem dependências, sem API key.

```typescript
// src/worker/agents/xsearch.ts
export interface XMention {
  url: string
  title: string
  snippet: string
  found_at: string   // ISO timestamp do momento do scrape
}

export async function scrapeXMentions(inscriptionId: string): Promise<XMention[]> {
  // busca pelo número E pelo hash curto (primeiros 8 chars)
  const shortHash = inscriptionId.substring(0, 8)
  const queries = [
    `site:x.com "inscription ${shortHash}"`,
    `site:x.com "${shortHash}"`,
  ]

  const allMentions: XMention[] = []

  for (const q of queries) {
    const mentions = await scrapeDDG(q)
    allMentions.push(...mentions)

    // rate limit: espera 2s entre queries
    if (queries.indexOf(q) < queries.length - 1)
      await sleep(2000)
  }

  // dedup por URL
  const seen = new Set<string>()
  return allMentions.filter(m => {
    if (seen.has(m.url)) return false
    seen.add(m.url)
    return true
  })
}

async function scrapeDDG(query: string): Promise<XMention[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ordinal-mind/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      // timeout via AbortSignal
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return []   // timeout ou network error — não bloqueia o pipeline
  }

  if (!res.ok) return []

  const mentions: XMention[] = []
  let current: Partial<XMention> = {}

  await new HTMLRewriter()
    .on(".result__title a", {
      element(el) {
        const href = el.getAttribute("href") ?? ""
        // DDG wraps links — extrair URL real do parâmetro uddg
        const real = extractDDGUrl(href)
        if (real && (real.includes("x.com/") || real.includes("twitter.com/"))) {
          current = { url: real, title: "", snippet: "", found_at: new Date().toISOString() }
        }
      },
      text(chunk) {
        if (current.url && chunk.text)
          current.title = (current.title ?? "") + chunk.text
      },
    })
    .on(".result__snippet", {
      text(chunk) {
        if (current.url && chunk.text) {
          current.snippet = (current.snippet ?? "") + chunk.text
          // considera o resultado completo quando o snippet fecha
          if (chunk.lastInTextNode && current.url) {
            mentions.push(current as XMention)
            current = {}
          }
        }
      },
    })
    .transform(res)
    .text()  // consome o response

  return mentions.slice(0, 8)  // máximo 8 menções por query
}

function extractDDGUrl(href: string): string | null {
  try {
    if (href.includes("uddg=")) {
      const u = new URL("https://x.com" + href)
      const uddg = u.searchParams.get("uddg")
      return uddg ? decodeURIComponent(uddg) : null
    }
    if (href.startsWith("http")) return href
    return null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
```

---

## timeline.ts — merge e sort de todos os eventos

Une metadados completos de `ordinals`, transferências rastreadas da `mempool` e scrape do `xsearch`.

```typescript
// src/worker/timeline.ts
import type { ChronicleEvent, InscriptionMeta } from "../app/lib/types"
import type { XMention } from "./agents/xsearch"
import type { EnrichedTransfer } from "./agents/mempool"

let _seq = 0
const uid = () => `ev_${Date.now()}_${_seq++}`

export function buildTimeline(
  meta: InscriptionMeta,
  transfers: EnrichedTransfer[],
  ordData: any, // kept for backward compatibility if needed, but data is now natively in `meta`
  xMentions: XMention[]
): ChronicleEvent[] {
  const events: ChronicleEvent[] = []

  // Genesis
  events.push({
    id: uid(),
    timestamp: meta.genesis_timestamp,
    block_height: meta.genesis_block,
    event_type: "genesis",
    source: { type: "onchain", ref: `block:${meta.genesis_block}` },
    description: `Inscrito no bloco ${meta.genesis_block} · sat #${meta.sat.toLocaleString("pt-BR")}`,
    metadata: {
      sat: meta.sat,
      content_type: meta.content_type,
      genesis_fee: meta.genesis_fee,
    },
  })

  // Sat context
  if (meta.sat_rarity !== "common") {
    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "sat_context",
      source: { type: "onchain", ref: `sat:${meta.sat}` },
      description: `Sat rarity: ${meta.sat_rarity}`,
      metadata: { sat_rarity: meta.sat_rarity },
    })
  }

  // Collection
  if (meta.collection) {
    events.push({
      id: uid(),
      timestamp: meta.genesis_timestamp,
      block_height: meta.genesis_block,
      event_type: "collection_link",
      source: { type: "onchain", ref: meta.collection.parent_inscription_id },
      description: `Faz parte da coleção: ${meta.collection.name ?? meta.collection.parent_inscription_id.substring(0, 12) + "..."}`,
      metadata: meta.collection as Record<string, unknown>,
    })
  }

  // Recursive Refs
  if (meta.recursive_refs) {
    for (const ref of meta.recursive_refs) {
      events.push({
        id: uid(),
        timestamp: meta.genesis_timestamp,
        block_height: meta.genesis_block,
        event_type: "recursive_ref",
        source: { type: "onchain", ref },
        description: `Referencia recursivamente a inscrição ${ref.substring(0, 12)}...`,
        metadata: { referenced_id: ref },
      })
    }
  }

  // Transfers
  for (const t of transfers) {
    const isSale = (t.value ?? 0) > 0
    events.push({
      id: uid(),
      timestamp: t.confirmed_at ?? new Date(0).toISOString(),
      block_height: t.block_height,
      event_type: isSale ? "sale" : "transfer",
      source: { type: "onchain", ref: t.tx_id },
      description: isSale
        ? `Vendido por ${(t.value! / 1e8).toFixed(8)} BTC · ${truncAddr(t.from_address)} → ?`
        : `Transferido · ${truncAddr(t.from_address)} → ?`,
      metadata: { from: t.from_address, value_sats: t.value },
    })
  }

  // Current Owner / Last Transfer Fallback
  if (meta.last_transfer && transfers.length === 0) {
    events.push({
      id: uid(),
      timestamp: meta.last_transfer.timestamp,
      block_height: meta.last_transfer.block_height,
      event_type: "transfer",
      source: { type: "onchain", ref: meta.last_transfer.tx_id },
      description: `Mantido em ${truncAddr(meta.last_transfer.to_address)}`,
      metadata: { to: meta.last_transfer.to_address },
    })
  }

  // X Mentions
  for (const m of xMentions) {
    events.push({
      id: uid(),
      timestamp: m.found_at,
      block_height: 0,
      event_type: "x_mention",
      source: { type: "web", ref: m.url },
      description: m.title ? m.title.substring(0, 100) : "Menção encontrada no X",
      metadata: { url: m.url, snippet: m.snippet },
    })
  }

  // Sort cronológico
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
  addr ? `${addr.substring(0, 8)}...${addr.substring(addr.length - 6)}` : "?"
```
