# Data Sources — Ordinal Mind

The architecture uses a multi-agent approach to aggregate public, cacheable data from multiple sources. Primary on-chain data comes from `ordinals.com`, while `mempool.space` acts as the UTXO indexer for forward transfer tracking. Enrichment is provided by UniSat and specialized web research agents.

---

## Agent 1 — Ordinals.com (src/worker/agents/ordinals.ts)

Base: `https://ordinals.com`

Provides raw inscription metadata, sat rarity, and CBOR traits.

```typescript
// src/worker/agents/ordinals.ts
export const fetchOrdinals = {
  async inscription(id: string): Promise<InscriptionMeta> {
    const res = await fetch(`https://ordinals.com/r/inscription/${id}`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`ordinals.com: inscription ${id} not found`)

    const data = await res.json() as any
    const genesisTxid = id.split("i")[0]

    return {
      inscription_id: data.id,
      inscription_number: data.number,
      sat: data.sat ?? 0,
      sat_rarity: await fetchSatRarity(data.sat),
      content_type: data.content_type,
      content_url: `https://ordinals.com/content/${data.id}`,
      genesis_block: data.height,
      genesis_timestamp: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date(0).toISOString(),
      genesis_fee: data.fee,
      owner_address: data.address ?? "?",
      satpoint: data.satpoint,
      genesis_txid: genesisTxid,
      genesis_vout: 0,
      current_output: data.output,
      collection: data.parent ? { parent_inscription_id: data.parent } : undefined,
    }
  },

  async metadata(id: string): Promise<Record<string, string> | null> {
    // Fetches and decodes CBOR metadata (traits)
    const res = await fetch(`https://ordinals.com/r/metadata/${id}`)
    if (!res.ok) return null
    // ... decoding logic using cbor library ...
  }
}
```

---

## Agent 2 — Mempool.space (src/worker/agents/mempool.ts)

Base: `https://mempool.space/api`

Used for **forward transfer tracking** via the outspend API. Starts from genesis and follows the inscription output until it reaches an unspent UTXO.

```typescript
// src/worker/agents/mempool.ts
export const fetchMempool = {
  async outspend(txid: string, vout: number): Promise<OutspendResponse> {
    const res = await fetch(`https://mempool.space/api/tx/${txid}/outspend/${vout}`)
    return (await res.json()) as OutspendResponse
  },

  async traceForward(genesisTxid: string, genesisVout: number): Promise<EnrichedTransfer[]> {
    let currentTxid = genesisTxid
    let currentVout = genesisVout
    const transfers = []

    while (true) {
      const outspend = await this.outspend(currentTxid, currentVout)
      if (!outspend.spent || !outspend.txid) break

      const tx = await this.tx(outspend.txid)
      const transfer = analyzeTransfer(tx, outspend.vin, currentVout)
      transfers.push(transfer)

      currentTxid = tx.txid
      currentVout = 0 // FIFO simplified
    }
    return transfers
  }
}
```

---

## Agent 3 — Mentions & Research (src/worker/agents/mentions & webResearch.ts)

Collects social signals (Google Trends) and web lore (SearXNG, Wikipedia, DDG).

```typescript
// src/worker/agents/mentions/index.ts
export async function collectSignals(input: MentionSearchInput): Promise<MentionCollectionResult> {
  const queries = buildMentionQueries(input)
  const [trendsResult] = await Promise.all([
    fetchGoogleTrendsMacro(input),
  ])
  // ... building CollectorSignals ...
}

// src/worker/agents/webResearch.ts
export async function fetchLoreContext(collectionName: string): Promise<WebResearchContext | null> {
  // Parallel racing across SearXNG instances, Wikipedia, and DDG Lite
  const searchResults = await searchSearXNG(collectionName)
  // ... extracting content via HTMLRewriter ...
}
```

---

## Agent 4 — UniSat (src/worker/agents/unisat.ts)

Base: `https://open-api.unisat.io`

Used for charm enrichment and market context.

```typescript
// src/worker/agents/unisat.ts
export const fetchUnisat = {
  async inscription(id: string, apiKey: string) {
    const res = await fetch(`https://open-api.unisat.io/v1/indexer/inscription/info?inscriptionId=${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    return res.json()
  }
}
```

---

## timeline.ts — Event Construction

Merges all data into a deterministic chronological tree.

```typescript
// src/worker/timeline.ts
export function buildTimeline(
  meta: InscriptionMeta,
  transfers: EnrichedTransfer[],
  socialMentions: SocialMention[],
  unisatEnrichment?: UnisatEnrichment
): ChronicleEvent[] {
  const events: ChronicleEvent[] = []

  // 1. Add Genesis & Sat Context
  // 2. Add Collection & Recursive Refs
  // 3. Add Transfers & Sales (with price detection)
  // 4. Add Social Mentions & Research Lore

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}
```
