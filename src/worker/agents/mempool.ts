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
  onProgress?: (step: number, description: string) => void
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
        onProgress(
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
}

/**
 * Analyzes a transaction to determine if it's a sale or simple transfer,
 * and extracts the real sale price when applicable.
 *
 * Sale detection heuristic (PSBT marketplace pattern):
 * - Seller signs with SIGHASH_SINGLE|ANYONECANPAY
 * - Seller's input contains the inscription
 * - Buyer adds funding inputs from different addresses
 * - Payment output goes to seller's chosen index (usually matches their input index)
 *
 * We detect this by:
 * 1. Checking if inputs come from multiple distinct addresses (multi-party).
 * 2. Looking at the output at the SAME index as the inscription input.
 * 3. If that output is NOT where the inscription landed, it's likely the payment.
 *
 * Fallback: searching for other outputs going to the seller's input address.
 */
export function analyzeTransfer(tx: MempoolTx, inscriptionVinIndex: number, inscriptionVout: number): EnrichedTransfer {
  const sellerPrevout = tx.vin[inscriptionVinIndex]?.prevout
  const sellerInputAddress = sellerPrevout?.scriptpubkey_address ?? "?"

  const buyerAddress = tx.vout[inscriptionVout]?.scriptpubkey_address ?? "?"
  const postageValue = tx.vout[inscriptionVout]?.value ?? 0

  // Multi-party detection: different addresses in inputs = probable marketplace/PSBT sale
  const inputAddresses = new Set(
    tx.vin
      .map(v => v.prevout?.scriptpubkey_address)
      .filter((addr): addr is string => addr != null)
  )
  const isMultiParty = inputAddresses.size > 1

  let salePrice = 0
  let paymentAddress = sellerInputAddress
  let isHeuristic = false

  if (isMultiParty) {
    // A. Marketplace Heuristic: SIGHASH_SINGLE index mapping
    // In a standard PSBT sale, Output N receives payment for Input N.
    const potentialPaymentOutput = tx.vout[inscriptionVinIndex]
    
    // If the output at the same index is NOT where the inscription landed, it's the payment.
    if (potentialPaymentOutput && inscriptionVout !== inscriptionVinIndex) {
      salePrice = potentialPaymentOutput.value
      paymentAddress = potentialPaymentOutput.scriptpubkey_address ?? sellerInputAddress
      isHeuristic = true
    }

    // B. Legacy Fallback: Search for any output going back to the seller's input address
    // (Excluding the inscription output itself)
    if (salePrice === 0) {
      for (let i = 0; i < tx.vout.length; i++) {
        if (i === inscriptionVout) continue 
        if (tx.vout[i].scriptpubkey_address === sellerInputAddress) {
          salePrice += tx.vout[i].value
          isHeuristic = true
        }
      }
    }
  }

  // Final validation: price must be significant to be considered a sale (avoid fee noise)
  const MIN_SALE_PRICE = 10000 
  const confirmedSale = isMultiParty && salePrice >= MIN_SALE_PRICE

  return {
    tx_id: tx.txid,
    from_address: sellerInputAddress,
    to_address: buyerAddress,
    value: confirmedSale ? salePrice : undefined,
    payment_address: confirmedSale ? paymentAddress : undefined,
    postage_value: postageValue,
    confirmed_at: tx.status.block_time
      ? new Date(tx.status.block_time * 1000).toISOString()
      : null,
    block_height: tx.status.block_height ?? 0,
    is_sale: confirmedSale,
    is_heuristic: isHeuristic,
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

const truncAddr = (addr: string) =>
  addr && addr !== "?"
    ? `${addr.substring(0, 8)}…${addr.substring(addr.length - 6)}`
    : "?"
