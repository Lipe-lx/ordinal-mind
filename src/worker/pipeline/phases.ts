import { fetchMempool } from "../agents/mempool"
import { fetchOrdinals } from "../agents/ordinals"
import { fetchUnisat } from "../agents/unisat"
import {
  buildMediaContext,
  fetchCollectionContext,
} from "../agents/collections"
import { collectSignals } from "../agents/mentions"
import { fetchLoreContext } from "../agents/webResearch"
import { buildTimeline } from "../timeline"
import { buildInscriptionRarity } from "../rarity"
import { validateAcrossSources, mergeCharms } from "../validation"
import {
  emptyCollectorSignals,
  fallbackCollectionData,
  emptyUnisatEnrichment,
} from "./defaults"
import { withRetry } from "./withRetry"
import type {
  ChronicleState,
  DiagnosticsContext,
  PhaseTrace,
} from "./types"
import type {
  InscriptionMeta,
  SourceCatalogItem,
  UnisatEnrichment,
  WebResearchContext,
} from "../../app/lib/types"
import type { MentionCollectionResult } from "../agents/mentions/types"

// --- Helpers moved from index.ts ---

function diagLog(
  diagnostics: DiagnosticsContext | undefined,
  event: string,
  data: Record<string, unknown> = {}
): void {
  if (!diagnostics?.debug) return
  const payload = {
    at: new Date().toISOString(),
    request_id: diagnostics.requestId,
    inscription_id: diagnostics.inscriptionId,
    route: diagnostics.route,
    event,
    ...data,
  }
  console.info(`[ChronicleDiag] ${JSON.stringify(payload)}`)
}

function summarizeSourceCatalog(
  sourceCatalog: Array<{ source_type: string; partial: boolean }>
): { total: number; partial: number; partialBySource: string[] } {
  const partialBySource = sourceCatalog
    .filter((entry) => entry.partial)
    .map((entry) => entry.source_type)
  return {
    total: sourceCatalog.length,
    partial: partialBySource.length,
    partialBySource,
  }
}

function buildMempoolSourceCatalog(options: {
  meta: InscriptionMeta
  fetchedAt: string
  transferFetchOk: boolean
  transferCount: number
  genesisTxFetched: boolean
}): SourceCatalogItem[] {
  const { meta, fetchedAt, transferFetchOk, transferCount, genesisTxFetched } =
    options
  return [
    {
      source_type: "mempool_genesis_tx",
      url_or_ref: `https://mempool.space/api/tx/${meta.genesis_txid}`,
      trust_level: "bitcoin_indexer",
      fetched_at: fetchedAt,
      partial: !genesisTxFetched,
      detail: genesisTxFetched
        ? "Genesis transaction fetched from mempool.space"
        : "Genesis transaction unavailable from mempool.space",
    },
    {
      source_type: "mempool_forward_transfer_trace",
      url_or_ref: `https://mempool.space/api/tx/${meta.genesis_txid}/outspend/${meta.genesis_vout}`,
      trust_level: "bitcoin_indexer",
      fetched_at: fetchedAt,
      partial: !transferFetchOk,
      detail: transferFetchOk
        ? `${transferCount} forward transfer${
            transferCount !== 1 ? "s" : ""
          } traced from genesis output`
        : "Forward transfer trace unavailable from mempool.space",
    },
  ]
}

async function fetchUnisatInfo(
  id: string,
  env: ChronicleState["env"],
  diagnostics?: DiagnosticsContext
): Promise<UnisatEnrichment["inscription_info"] | null> {
  const apiKey = env.UNISAT_API_KEY
  if (!apiKey) {
    diagLog(diagnostics, "unisat_skipped_no_key")
    return null
  }

  try {
    const info = await fetchUnisat.inscription(id, apiKey)
    if (info) {
      diagLog(diagnostics, "unisat_loaded", {
        charms_count: info.charms?.length ?? 0,
        has_metaprotocol: Boolean(info.metaprotocol),
      })
      return {
        charms: info.charms || [],
        sat: info.sat || 0,
        metaprotocol: info.metaprotocol || null,
        content_length: info.contentLength || 0,
      }
    }
    diagLog(diagnostics, "unisat_empty")
  } catch (err) {
    console.error("UniSat info fetch failed:", err)
    diagLog(diagnostics, "unisat_error", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return null
}

// --- Trace Helper ---

function startPhase(state: ChronicleState, name: string): PhaseTrace {
  return {
    name,
    started_at: new Date().toISOString(),
    completed_at: "",
    duration_ms: 0,
    status: "ok",
  }
}

function endPhase(
  state: ChronicleState,
  trace: PhaseTrace,
  status: "ok" | "partial" | "failed" = "ok",
  detail?: Record<string, unknown>
) {
  trace.completed_at = new Date().toISOString()
  trace.duration_ms =
    new Date(trace.completed_at).getTime() -
    new Date(trace.started_at).getTime()
  trace.status = status
  trace.detail = detail
  state.trace.phases.push(trace)
}

// --- Pipeline Phases ---

export async function fetchMetadata(
  state: ChronicleState
): Promise<ChronicleState> {
  const phase = startPhase(state, "metadata")
  await state.onProgress?.("metadata", 1, "Fetching inscription data from ordinals.com…")

  try {
    const [metaRes, cborRes] = await Promise.all([
      withRetry(() => fetchOrdinals.inscription(state.inscriptionId), {
        label: "ord_inscription",
      }),
      fetchOrdinals.metadata(state.inscriptionId, {
        debug: state.diagnostics.debug,
        requestId: state.diagnostics.requestId,
      }),
    ])
    state.meta = metaRes
    state.cborTraits = cborRes

    diagLog(state.diagnostics, "metadata_loaded", {
      inscription_number: state.meta.inscription_number,
      has_cbor_traits: Boolean(state.cborTraits),
      cbor_trait_count: state.cborTraits ? Object.keys(state.cborTraits).length : 0,
    })

    await state.onProgress?.(
      "metadata",
      2,
      `Found inscription #${state.meta.inscription_number} · sat #${state.meta.sat}`
    )
    endPhase(state, phase)
  } catch (err) {
    endPhase(state, phase, "failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  return state
}

export async function parallelFetch(
  state: ChronicleState
): Promise<ChronicleState> {
  const phase = startPhase(state, "parallel_fetch")
  if (!state.meta) throw new Error("Metadata missing for parallel fetch")

  await state.onProgress?.("transfers", 0, "Starting forward transfer scan via mempool.space…")

  let transferCount = 0
  const [splitTraceRes, collectionContextRes, genesisTxRes, unisatInfoRes] =
    await Promise.allSettled([
      state.lite
        ? Promise.resolve({ headTransfers: [], tailTransfers: [], skippedCount: 0 })
        : fetchMempool.traceSplit(
            state.meta.genesis_txid,
            state.meta.genesis_vout,
            state.meta.current_output,
            state.meta.satpoint,
            {
              headLimit: 3,
              tailLimit: 27,
              delayMs: state.diagnostics.route === "stream" ? 150 : 0,
              onProgress: async (step, desc) => {
                transferCount = step
                await state.onProgress?.("transfers", step, desc)
              },
            }
          ),
      fetchCollectionContext(state.inscriptionId, state.meta, {
        debug: state.diagnostics.debug,
        requestId: state.diagnostics.requestId,
        ordNetApiKey: state.env.ORD_NET_API_KEY,
        onProgress: async (desc) => {
          await state.onProgress?.("transfers", 1, desc)
        },
      }),
      fetchMempool.tx(state.meta.genesis_txid),
      fetchUnisatInfo(state.inscriptionId, state.env, state.diagnostics),
    ])

  const splitResult = splitTraceRes.status === "fulfilled" ? splitTraceRes.value : null
  state.transfers = splitResult
    ? [...splitResult.headTransfers, ...splitResult.tailTransfers]
    : []
  state.transfersFetched = splitTraceRes.status === "fulfilled"
  state.skippedTransferCount = splitResult?.skippedCount ?? 0
  state.headTransferCount = splitResult?.headTransfers.length ?? 0
  state.collectionData =
    collectionContextRes.status === "fulfilled"
      ? collectionContextRes.value
      : fallbackCollectionData(state.meta)
  state.genesisTxResult =
    genesisTxRes.status === "fulfilled" ? genesisTxRes.value : null
  state.genesisTxFetched =
    genesisTxRes.status === "fulfilled" && !!genesisTxRes.value
  const unisatInfo = unisatInfoRes.status === "fulfilled" ? unisatInfoRes.value : null

  // This will be used in Phase 4
  state.unisatEnrichment = {
    inscription_info: unisatInfo,
    collection_context: null,
    market_info: { listed: false, price_sats: null, item_name: null },
    rarity: null,
    source_catalog: [],
  }

  diagLog(state.diagnostics, "parallel_fetch_status", {
    transfers: splitTraceRes.status,
    collection_context: collectionContextRes.status,
    genesis_tx: genesisTxRes.status,
    unisat: unisatInfoRes.status,
  })

  await state.onProgress?.(
    "transfers",
    transferCount,
    `Found ${state.transfers.length} transfer${
      state.transfers.length !== 1 ? "s" : ""
    } (${
      state.transfers.filter((t) => t.is_sale).length
    } sale${state.transfers.filter((t) => t.is_sale).length !== 1 ? "s" : ""})`
  )

  endPhase(state, phase, "ok", {
    transfers_count: state.transfers.length,
    collection_found: collectionContextRes.status === "fulfilled",
  })
  return state
}

export async function dependentFetch(
  state: ChronicleState
): Promise<ChronicleState> {
  const phase = startPhase(state, "dependent_fetch")
  if (!state.meta || !state.collectionData)
    throw new Error("Prerequisites missing for dependent fetch")

  await state.onProgress?.("mentions", 1, "Collecting public social signals…")

  const collectionNameForResearch =
    state.collectionData.collectionContext.profile?.name ??
    state.collectionData.collectionContext.presentation.primary_label ??
    state.collectionData.mentionSearchHints.collectionName ??
    state.collectionData.collectionContext.market.match?.collection_name

  const [mentionSignalsRes, webResearchResultRes] = state.lite
    ? ([
        {
          status: "fulfilled",
          value: {
            mentions: [],
            collectorSignals: emptyCollectorSignals(),
            sourceCatalog: [],
            debugInfo: undefined,
          },
        },
        { status: "fulfilled", value: null },
      ] as [
        PromiseSettledResult<MentionCollectionResult>,
        PromiseSettledResult<WebResearchContext | null>
      ])
    : await Promise.allSettled([
        collectSignals({
          inscriptionId: state.inscriptionId,
          inscriptionNumber: state.meta.inscription_number,
          collectionName: collectionNameForResearch,
          itemName:
            state.collectionData.collectionContext.presentation.item_label ??
            state.collectionData.mentionSearchHints.itemName,
          fullLabel: state.collectionData.collectionContext.presentation.full_label,
          officialXUrls: state.collectionData.mentionSearchHints.officialXUrls,
          debug: state.diagnostics.debug,
          requestId: state.diagnostics.requestId,
        }),
        collectionNameForResearch
          ? (async () => {
              if (state.diagnostics.route === "stream") {
                await state.onProgress?.(
                  "mentions",
                  2,
                  `Searching lore for ${collectionNameForResearch}…`
                )
              }
              return fetchLoreContext(collectionNameForResearch)
            })()
          : Promise.resolve(null),
      ])

  state.mentions =
    mentionSignalsRes.status === "fulfilled"
      ? mentionSignalsRes.value.mentions
      : []
  state.collectorSignals =
    mentionSignalsRes.status === "fulfilled"
      ? mentionSignalsRes.value.collectorSignals
      : emptyCollectorSignals()
  state.mentionSourceCatalog =
    mentionSignalsRes.status === "fulfilled"
      ? mentionSignalsRes.value.sourceCatalog
      : []
  state.mentionDebugInfo =
    mentionSignalsRes.status === "fulfilled"
      ? mentionSignalsRes.value.debugInfo
      : undefined
  state.webResearch =
    webResearchResultRes.status === "fulfilled"
      ? webResearchResultRes.value
      : null

  if (state.webResearch && state.webResearch.results.length > 0) {
    await state.onProgress?.(
      "mentions",
      3,
      `Extracted lore from ${state.webResearch.results.length} sources`
    )
  }

  diagLog(state.diagnostics, "dependent_fetch_status", {
    collector_signals: mentionSignalsRes.status,
    lore: webResearchResultRes.status,
  })

  endPhase(state, phase)
  return state
}

export async function enrichment(
  state: ChronicleState
): Promise<ChronicleState> {
  const phase = startPhase(state, "enrichment")
  if (!state.meta || !state.unisatEnrichment)
    throw new Error("Prerequisites missing for enrichment")

  await state.onProgress?.("unisat", 1, "Enriching traits and UniSat indexer data…")

  const marketMatch = state.collectionData?.collectionContext.market?.match
  const marketRarity = marketMatch?.rarity_overlay
  state.rarity = buildInscriptionRarity(state.cborTraits, marketRarity)

  // Re-build unisat enrichment with rarity and catalog
  state.unisatEnrichment = emptyUnisatEnrichment(
    state.inscriptionId,
    state.unisatEnrichment.inscription_info,
    state.rarity
  )

  if (state.rarity) {
    if (state.cborTraits) {
      state.unisatEnrichment.source_catalog.push({
        source_type: "ordinals_cbor_metadata",
        url_or_ref: `https://ordinals.com/r/metadata/${state.inscriptionId}`,
        trust_level: "official_index",
        fetched_at: new Date().toISOString(),
        partial: false,
      })
    }
    if (marketRarity) {
      const raritySourceRef =
        marketRarity.source_ref ?? marketMatch?.source_ref
      if (raritySourceRef) {
        state.unisatEnrichment.source_catalog.push({
          source_type:
            marketRarity.source === "satflow"
              ? "satflow_rarity_stats"
              : "ord_net_rarity_overlay",
          url_or_ref: raritySourceRef,
          trust_level: "market_overlay",
          fetched_at: new Date().toISOString(),
          partial: false,
        })
      }
    }
  }

  diagLog(state.diagnostics, "rarity_pipeline_summary", {
    cbor_trait_count: state.cborTraits ? Object.keys(state.cborTraits).length : 0,
    market_rarity_source: marketRarity?.source ?? null,
    market_trait_count: marketRarity?.traits.length ?? 0,
    market_rank: marketRarity?.rank ?? null,
    market_supply: marketRarity?.supply ?? null,
    rarity_trait_count: state.rarity?.traits.length ?? 0,
    rarity_breakdown_count: state.rarity?.trait_breakdown.length ?? 0,
  })

  // Update meta with collection name, address, charms
  if (state.collectionData?.collectionName && state.meta.collection) {
    state.meta = {
      ...state.meta,
      collection: {
        ...state.meta.collection,
        name: state.collectionData.collectionName,
      },
    }
  }

  const genesisOwnerAddress =
    state.genesisTxResult?.vout?.[state.meta.genesis_vout]?.scriptpubkey_address ??
    state.transfers[0]?.from_address
  if (genesisOwnerAddress) {
    state.meta = {
      ...state.meta,
      genesis_owner_address: genesisOwnerAddress,
    }
  }

  if (state.unisatEnrichment.inscription_info?.charms) {
    state.meta = {
      ...state.meta,
      charms: mergeCharms(
        state.meta.sat_rarity,
        state.unisatEnrichment.inscription_info.charms
      ),
    }
  }

  // Cross-source validation
  const validationUnisatInfo = state.unisatEnrichment.inscription_info
    ? {
        inscriptionId: state.inscriptionId,
        inscriptionNumber: state.meta.inscription_number,
        address: state.meta.owner_address,
        contentType: state.meta.content_type,
        contentLength: state.unisatEnrichment.inscription_info.content_length,
        height: state.meta.genesis_block,
        timestamp: new Date(state.meta.genesis_timestamp).getTime() / 1000,
        sat: state.unisatEnrichment.inscription_info.sat,
        genesisTransaction: state.meta.genesis_txid,
        offset: 0,
        charms: state.unisatEnrichment.inscription_info.charms,
        metaprotocol: state.unisatEnrichment.inscription_info.metaprotocol,
      }
    : null
  state.validation = validateAcrossSources(state.meta, validationUnisatInfo)

  if (state.rarity?.rarity_rank != null) {
    await state.onProgress?.(
      "unisat",
      2,
      `Rarity rank #${state.rarity.rarity_rank} of ${state.rarity.total_supply} (top ${state.rarity.rarity_percentile}%)`
    )
  } else if (state.rarity?.traits && state.rarity.traits.length > 0) {
    await state.onProgress?.(
      "unisat",
      2,
      `Found ${state.rarity.traits.length} traits`
    )
  } else {
    await state.onProgress?.(
      "unisat",
      2,
      state.unisatEnrichment.inscription_info
        ? "UniSat indexer data loaded"
        : "No rarity or indexer data found"
    )
  }

  endPhase(state, phase)
  return state
}

export async function buildOutput(
  state: ChronicleState
): Promise<ChronicleState> {
  const phase = startPhase(state, "output")
  if (!state.meta) throw new Error("Metadata missing for output")

  await state.onProgress?.("complete", 1, "Building timeline…")

  state.events = buildTimeline(
    state.meta,
    state.transfers,
    state.mentions,
    state.unisatEnrichment ?? undefined
  )

  const fetchedAt = new Date().toISOString()
  const mempoolSourceCatalog = buildMempoolSourceCatalog({
    meta: state.meta,
    fetchedAt,
    transferFetchOk: state.transfersFetched,
    transferCount: state.transfers.length,
    genesisTxFetched: state.genesisTxFetched,
  })

  state.sourceCatalog = [
    ...(state.collectionData?.sourceCatalog ?? []),
    ...mempoolSourceCatalog,
    ...state.mentionSourceCatalog,
    ...(state.unisatEnrichment?.source_catalog ?? []),
  ]

  diagLog(
    state.diagnostics,
    "source_catalog_summary",
    summarizeSourceCatalog(state.sourceCatalog)
  )

  state.chronicle = {
    inscription_id: state.inscriptionId,
    meta: state.meta,
    events: state.events,
    collector_signals: state.collectorSignals,
    media_context:
      state.collectionData?.mediaContext ?? buildMediaContext(state.meta),
    collection_context:
      state.collectionData?.collectionContext ??
      fallbackCollectionData(state.meta).collectionContext,
    web_research: state.webResearch || undefined,
    source_catalog: state.sourceCatalog,
    cached_at: fetchedAt,
    unisat_enrichment: state.unisatEnrichment ?? undefined,
    validation: state.validation || undefined,
    debug_info: state.diagnostics.debug
      ? state.mentionDebugInfo
      : undefined,
    timeline_split: state.skippedTransferCount !== 0
      ? {
          head_transfer_count: state.headTransferCount,
          skipped_count: state.skippedTransferCount,
        }
      : undefined,
  }

  state.trace.total_duration_ms =
    new Date().getTime() - new Date(state.trace.phases[0].started_at).getTime()
  
  endPhase(state, phase)
  return state
}
