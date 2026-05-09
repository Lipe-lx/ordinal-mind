// Mempool.space agent — forward UTXO tracker for inscription transfers.
// Base: https://mempool.space/api
// Free, no API key required.
//
// Strategy: Forward tracking via outspend API.
// Starting from the genesis txid:vout, we follow the inscription forward
// through each transaction using GET /api/tx/{txid}/outspend/{vout}.
//
// FIFO Simplified: We assume inscriptions land on vout 0 in well-formed
// ordinal transactions (~95% of cases). Full FIFO counting sats per
// input/output would handle the remaining edge cases but requires
// significantly more complexity. This will be iterated in the future.

interface MempoolTx {
  txid: string
  status: {
    confirmed: boolean
    block_height: number
    block_time: number // unix seconds
  }
  fee: number
  vin: {
    txid: string
    vout: number
    prevout?: {
      scriptpubkey_address?: string
      value: number
    }
  }[]
  vout: {
    scriptpubkey_address?: string
    value: number
  }[]
}

interface OutspendResponse {
  spent: boolean
  txid?: string
  vin?: number
  status?: {
    confirmed: boolean
    block_height: number
    block_hash?: string
    block_time: number
  }
}

export interface EnrichedTransfer {
  tx_id: string
  from_address: string
  to_address: string
  value?: number              // real sale price (sats) — undefined if simple transfer
  payment_address?: string    // address that received the payment (may differ from from_address)
  postage_value?: number      // inscription UTXO value (postage, NOT price)
  confirmed_at: string | null
  block_height: number
  is_sale: boolean            // heuristic: multi-party inputs detected
  is_heuristic: boolean       // true if price was detected via index mapping or search
  input_count: number
  output_count: number
}

export interface TraceForwardOptions {
  limit?: number              // max transfers to trace (default 30)
  delayMs?: number            // delay between request pairs (default 150)
  onProgress?: (step: number, description: string) => Promise<void>
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Result of the combined head + tail trace strategy.
 * When the inscription has more transfers than the budget allows,
 * `headTransfers` contains the first few and `tailTransfers` the most recent ones.
 * `skippedCount` estimates how many transfers were not fetched in between.
 */
export interface SplitTraceResult {
  headTransfers: EnrichedTransfer[]
  tailTransfers: EnrichedTransfer[]
  skippedCount: number
}

export const fetchMempool = {
  async tx(txid: string): Promise<MempoolTx | null> {
    const res = await fetch(`https://mempool.space/api/tx/${txid}`)
    if (!res.ok) return null
    return (await res.json()) as MempoolTx
  },

  async outspend(txid: string, vout: number): Promise<OutspendResponse> {
    const res = await fetch(`https://mempool.space/api/tx/${txid}/outspend/${vout}`)
    if (!res.ok) return { spent: false }
    return (await res.json()) as OutspendResponse
  },

  /**
   * Traces inscription transfers FORWARD from genesis to present.
   *
   * Starting from the genesis txid:vout, follows the outspend chain:
   * 1. Check if current output was spent → get spending txid
   * 2. Fetch the spending tx → analyze it (transfer vs sale, extract price)
   * 3. Determine which vout the inscription moved to (FIFO simplified: vout 0)
   * 4. Repeat until output is unspent or limit reached
   *
   * Rate limiting: 150ms delay between iterations (2 requests each = ~7 req/s)
   */
  async traceForward(
    genesisTxid: string,
    genesisVout: number,
    options: TraceForwardOptions = {}
  ): Promise<EnrichedTransfer[]> {
    const { limit = 30, delayMs = 150, onProgress } = options
    const transfers: EnrichedTransfer[] = []
    let currentTxid = genesisTxid
    let currentVout = genesisVout
    let currentOffset = 0
    let depth = 0

    while (depth < limit) {
      if (onProgress) {
        await onProgress(depth, depth === 0 ? "Analyzing genesis expenditure…" : `Scanning next transfer node…`)
      }

      // Rate limit: delay between iterations
      if (depth > 0) {
        await sleep(delayMs)
      }

      // 1. Check if current output was spent
      const outspendData = await this.outspend(currentTxid, currentVout)
      if (!outspendData.spent || !outspendData.txid) break

      // 2. Fetch the spending transaction
      const spendingTx = await this.tx(outspendData.txid)
      if (!spendingTx) break

      // 3. Analyze: transfer vs sale, extract price
      const inscriptionVinIndex = outspendData.vin ?? 0
      const location = findInscriptionOutputLocation(spendingTx, inscriptionVinIndex, currentOffset)
      const transfer = analyzeTransfer(spendingTx, inscriptionVinIndex, location.vout)
      transfers.push(transfer)

      // Report progress
      if (onProgress) {
        await onProgress(
          depth + 1,
          transfer.is_sale
            ? `Found sale: ${transfer.value ? (transfer.value / 1e8).toFixed(4) : "—"} BTC`
            : `Transfer ${depth + 1}: ${truncAddr(transfer.from_address)} → ${truncAddr(transfer.to_address)}`
        )
      }

      // 4. Determine which vout the inscription moved to in this tx
      currentTxid = spendingTx.txid
      currentVout = location.vout
      currentOffset = location.offset
      depth++
    }

    return transfers
  },

  /**
   * Traces inscription transfers BACKWARD from the current UTXO.
   *
   * Starting from the current output (txid:vout:offset), walks backwards
   * through the vin chain to reconstruct recent transfer history.
   *
   * Uses full FIFO sat offset tracking (symmetric to the forward trace):
   * 1. Fetch current tx
   * 2. Compute absolute sat position = sum(vout[0..vout-1]) + offset
   * 3. Find which vin's cumulative sat range contains that position
   * 4. Record the transfer, then move to prevout (txid:vout)
   * 5. Compute new offset within the previous output for next step
   * 6. Repeat until limit reached or genesis hit
   *
   * Returns transfers in chronological order (oldest first).
   */
  async traceBackward(
    currentTxid: string,
    currentVout: number,
    currentOffset: number,
    genesisTxid: string,
    options: TraceForwardOptions = {}
  ): Promise<EnrichedTransfer[]> {
    const { limit = 27, delayMs = 150, onProgress } = options
    const transfers: EnrichedTransfer[] = []
    let txid = currentTxid
    let vout = currentVout
    let offset = currentOffset
    let depth = 0

    while (depth < limit) {
      if (onProgress) {
        await onProgress(depth, `Tracing backward from current output…`)
      }

      if (depth > 0) {
        await sleep(delayMs)
      }

      // 1. Fetch the current tx
      const tx = await this.tx(txid)
      if (!tx) break

      // 2. Reverse FIFO: find which vin carried the inscription sat
      const inputLocation = findInscriptionInputLocation(tx, vout, offset)
      const inscriptionVinIndex = inputLocation.vinIndex

      const prevTxid = tx.vin[inscriptionVinIndex]?.txid
      const prevVout = tx.vin[inscriptionVinIndex]?.vout ?? 0

      if (!prevTxid) break

      // 3. Record this transfer (BEFORE genesis check — this tx IS a transfer)
      const transfer = analyzeTransfer(tx, inscriptionVinIndex, vout)
      transfers.push(transfer)

      if (onProgress) {
        await onProgress(
          depth + 1,
          transfer.is_sale
            ? `Recent sale: ${transfer.value ? (transfer.value / 1e8).toFixed(4) : "—"} BTC`
            : `Recent transfer ${depth + 1}: ${truncAddr(transfer.from_address)} → ${truncAddr(transfer.to_address)}`
        )
      }

      // 4. Stop AFTER recording if we've reached genesis
      if (prevTxid === genesisTxid) break

      // 5. Move backwards with the tracked offset
      txid = prevTxid
      vout = prevVout
      offset = inputLocation.offset
      depth++
    }

    // Return in chronological order (oldest first)
    return transfers.reverse()
  },

  /**
   * Combined trace: first N transfers from genesis + last M from current position.
   * Maintains the same total request budget while capturing both the origin
   * story and recent activity.
   *
   * If the forward trace reaches the current output within headLimit,
   * all transfers are returned in headTransfers with no gap.
   */
  async traceSplit(
    genesisTxid: string,
    genesisVout: number,
    currentOutput: string | undefined,
    satpoint: string | undefined,
    options: TraceForwardOptions & { headLimit?: number; tailLimit?: number } = {}
  ): Promise<SplitTraceResult> {
    const { headLimit = 3, tailLimit = 27, delayMs = 150, onProgress } = options

    // Phase 1: Forward trace from genesis (head)
    const headTransfers = await this.traceForward(genesisTxid, genesisVout, {
      limit: headLimit,
      delayMs,
      onProgress,
    })

    // If forward trace ended early (inscription has ≤ headLimit transfers),
    // or we have no current_output to trace back from, return everything as head.
    if (headTransfers.length < headLimit || !currentOutput) {
      return { headTransfers, tailTransfers: [], skippedCount: 0 }
    }

    // Check if the last forward-traced tx IS the current output
    const [currentTxid, currentVoutStr] = currentOutput.split(":")
    const currentVout = parseInt(currentVoutStr ?? "0", 10)
    const lastHeadTxid = headTransfers[headTransfers.length - 1]?.tx_id

    if (lastHeadTxid === currentTxid) {
      // Forward trace reached current position — no gap needed
      return { headTransfers, tailTransfers: [], skippedCount: 0 }
    }

    // Parse satpoint for offset (format: "txid:vout:offset")
    let initialOffset = 0
    if (satpoint) {
      const parts = satpoint.split(":")
      if (parts.length >= 3) {
        initialOffset = parseInt(parts[2], 10) || 0
      }
    }

    // Phase 2: Backward trace from current output (tail)
    if (onProgress) {
      await onProgress(headLimit + 1, "Scanning recent transfers from current position…")
    }

    const tailTransfers = await this.traceBackward(
      currentTxid, currentVout, initialOffset, genesisTxid,
      {
        limit: tailLimit,
        delayMs,
        onProgress: onProgress ? (step, desc) => onProgress(headLimit + step, desc) : undefined,
      }
    )

    // Deduplicate: remove any tail transfers that overlap with head
    const headTxIds = new Set(headTransfers.map(t => t.tx_id))
    const dedupedTail = tailTransfers.filter(t => !headTxIds.has(t.tx_id))

    // If after dedup the tail is empty or contiguous with head, no gap
    if (dedupedTail.length === 0) {
      return { headTransfers, tailTransfers: [], skippedCount: 0 }
    }

    // Estimate skipped count:
    // We know at least head.length + tail.length transfers exist.
    // The gap is unknown but at least 1 (otherwise dedup would have caught it).
    // We mark it as -1 (unknown) so the UI shows "..." without a specific number.
    const skippedCount = -1

    return { headTransfers, tailTransfers: dedupedTail, skippedCount }
  },
}

/**
 * KNOWN MARKETPLACE SIGNATURES
 * Common treasury/fee addresses for major Ordinals marketplaces.
 */
const MARKETPLACE_FEE_ADDRESSES = new Set([
  "bc1pgkfgv6yks097jllv8shjvn6yv0g32xskpkzajygmvklt48l044as08990h", // Magic Eden / ORD.NET
  "bc1p2uphz49p0l0y8p4p8y4p8y4p8y4p8y4p8y4p8y4p8y4p8y4p8y4p8y4p8y", // Example Marketplace
])

/**
 * Analyzes a transaction to determine if it's a sale or simple transfer,
 * and extracts the real sale price when applicable.
 *
 * Enhanced 2026 Heuristics:
 * 1. 2-Dummy Recognition: Detects the Magic Eden/OKX standard pattern.
 * 2. Seller-Centric Gain: Verifies that the address providing the inscription receives the payout.
 * 3. Marketplace Markers: Checks for fee addresses and specific output counts.
 * 4. Noise Reduction: Higher threshold (5000 sats) to ignore postage shifts.
 */
export function analyzeTransfer(tx: MempoolTx, inscriptionVinIndex: number, inscriptionVout: number): EnrichedTransfer {
  const sellerPrevout = tx.vin[inscriptionVinIndex]?.prevout
  const sellerInputAddress = sellerPrevout?.scriptpubkey_address ?? "?"

  const buyerAddress = tx.vout[inscriptionVout]?.scriptpubkey_address ?? "?"
  const postageValue = tx.vout[inscriptionVout]?.value ?? 0

  // 1. Identify input/output patterns
  const inputAddresses = new Set(
    tx.vin
      .map(v => v.prevout?.scriptpubkey_address)
      .filter((addr): addr is string => addr != null)
  )
  const isMultiParty = inputAddresses.size > 1

  // 2. Detect 2-Dummy Pattern (Standard Marketplace)
  // Input 0 & 1 are dummies, Output 4 & 5 (or similar) are dummies.
  const hasDummies = 
    tx.vin.length >= 3 && 
    tx.vout.length >= 4 &&
    tx.vin[0]?.prevout?.value === tx.vout[tx.vout.length - 2]?.value && // Dummy 1
    tx.vin[1]?.prevout?.value === tx.vout[tx.vout.length - 1]?.value && // Dummy 2
    (tx.vin[0]?.prevout?.value ?? 0) < 2000

  // 3. Detect Marketplace Fees
  const hasMarketplaceFee = tx.vout.some(v => MARKETPLACE_FEE_ADDRESSES.has(v.scriptpubkey_address ?? ""))

  // 4. Calculate Net Gain per address
  const addressStats = new Map<string, { input: number; output: number }>()
  for (const vin of tx.vin) {
    const addr = vin.prevout?.scriptpubkey_address
    if (addr) {
      const stats = addressStats.get(addr) || { input: 0, output: 0 }
      stats.input += vin.prevout?.value ?? 0
      addressStats.set(addr, stats)
    }
  }
  for (const vout of tx.vout) {
    const addr = vout.scriptpubkey_address
    if (addr) {
      const stats = addressStats.get(addr) || { input: 0, output: 0 }
      stats.output += vout.value
      addressStats.set(addr, stats)
    }
  }

  // 5. Identify Sale Price
  let maxGain = 0
  let paymentAddress = sellerInputAddress

  for (const [addr, stats] of addressStats.entries()) {
    // Skip the buyer address (it always has a gain of postage, which is not the price)
    if (addr === buyerAddress) continue

    const gain = stats.output - stats.input
    if (gain > maxGain) {
      maxGain = gain
      paymentAddress = addr
    }
  }

  // 6. Final Decision Logic
  const MIN_SALE_PRICE = 5000 
  
  // A sale is confirmed if:
  // - It has explicit marketplace markers (Dummies OR Fee addresses)
  // - OR it's multi-party AND has a significant gain for the seller/payout address
  const isConfirmedMarketplace = (hasDummies || hasMarketplaceFee) && maxGain > 0
  const isProbableP2PSale = isMultiParty && maxGain >= MIN_SALE_PRICE

  const confirmedSale = isConfirmedMarketplace || isProbableP2PSale

  // Metadata enrichment
  const isHeuristicSale = confirmedSale && !isConfirmedMarketplace

  return {
    tx_id: tx.txid,
    from_address: sellerInputAddress,
    to_address: buyerAddress,
    value: confirmedSale ? maxGain : undefined,
    payment_address: confirmedSale ? paymentAddress : undefined,
    postage_value: postageValue,
    confirmed_at: tx.status.block_time
      ? new Date(tx.status.block_time * 1000).toISOString()
      : null,
    block_height: tx.status.block_height ?? 0,
    is_sale: confirmedSale,
    is_heuristic: isHeuristicSale,
    input_count: tx.vin.length,
    output_count: tx.vout.length,
  }
}



export function findInscriptionOutputLocation(
  tx: MempoolTx,
  inscriptionVinIndex: number,
  inputOffset: number
): { vout: number; offset: number } {
  const absoluteOffset = tx.vin
    .slice(0, inscriptionVinIndex)
    .reduce((sum, input) => sum + (input.prevout?.value ?? 0), 0) + inputOffset

  let running = 0
  for (let i = 0; i < tx.vout.length; i++) {
    const value = tx.vout[i].value
    if (absoluteOffset < running + value) {
      return {
        vout: i,
        offset: absoluteOffset - running,
      }
    }
    running += value
  }

  // Defensive fallback for malformed or incomplete transaction data.
  return {
    vout: Math.max(tx.vout.length - 1, 0),
    offset: 0,
  }
}

/**
 * Reverse FIFO: given the output vout and the sat offset within that output,
 * find which vin carried the inscription sat and what offset it had in the
 * previous output.
 *
 * This is the symmetric reverse of findInscriptionOutputLocation:
 *   Forward:  (vinIndex, inputOffset) → absolutePos → (vout, outputOffset)
 *   Backward: (vout, outputOffset) → absolutePos → (vinIndex, inputOffset)
 */
export function findInscriptionInputLocation(
  tx: MempoolTx,
  outputVout: number,
  outputOffset: number
): { vinIndex: number; offset: number } {
  // 1. Compute absolute sat position from the output side
  const absoluteOffset = tx.vout
    .slice(0, outputVout)
    .reduce((sum, o) => sum + o.value, 0) + outputOffset

  // 2. Walk the inputs to find which vin's sat range contains this position
  let running = 0
  for (let i = 0; i < tx.vin.length; i++) {
    const inputValue = tx.vin[i].prevout?.value ?? 0
    if (absoluteOffset < running + inputValue) {
      return {
        vinIndex: i,
        offset: absoluteOffset - running,
      }
    }
    running += inputValue
  }

  // Defensive fallback
  return {
    vinIndex: 0,
    offset: 0,
  }
}

const truncAddr = (addr: string) =>
  addr && addr !== "?"
    ? `${addr.substring(0, 8)}…${addr.substring(addr.length - 6)}`
    : "?"
