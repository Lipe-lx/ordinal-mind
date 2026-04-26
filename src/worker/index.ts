// Worker entrypoint — routing and orchestration.
// Routes:
//   OPTIONS *            → CORS preflight
//   GET /api/chronicle   → resolver → cache → parallel fetch → timeline → response
//   GET /api/chronicle?stream=1 → SSE streaming with progress feedback
//   * (everything else)  → env.ASSETS.fetch(request) — SPA static assets

import { resolveInput } from "./resolver"
import { fetchMempool } from "./agents/mempool"
import { fetchOrdinals } from "./agents/ordinals"
import { fetchUnisat } from "./agents/unisat"
import { buildMediaContext, fetchCollectionContext } from "./agents/collections"
import { collectSignals } from "./agents/mentions"
import { buildTimeline } from "./timeline"
import { cacheGet, cachePut } from "./cache"
import { buildInscriptionRarity } from "./rarity"
import { validateAcrossSources, mergeCharms } from "./validation"
import { db } from "./db"
import type { InscriptionMeta, SourceCatalogItem, UnisatEnrichment } from "../app/lib/types"

export interface Env {
  CHRONICLES_KV: KVNamespace
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  ENVIRONMENT: string
  UNISAT_API_KEY?: string
  NOSTR_RELAYS?: string
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

interface DiagnosticsContext {
  debug: boolean
  requestId: string
  route: "standard" | "stream"
  inscriptionId: string
}

function newRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

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
  const { meta, fetchedAt, transferFetchOk, transferCount, genesisTxFetched } = options
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
        ? `${transferCount} forward transfer${transferCount !== 1 ? "s" : ""} traced from genesis output`
        : "Forward transfer trace unavailable from mempool.space",
    },
  ]
}

function parseNostrRelays(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const relays = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return relays.length > 0 ? relays : undefined
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS })
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      return handleApi(url, env)
    }

    // Serve static assets (SPA fallback handled by wrangler.jsonc config)
    return env.ASSETS.fetch(request)
  },
}

async function handleApi(url: URL, env: Env): Promise<Response> {
  // GET /api/chronicle?id=<inscription_id_or_number_or_address>&stream=1
  if (url.pathname === "/api/chronicle") {
    const raw = url.searchParams.get("id")
    if (!raw) {
      return jsonResponse({ error: "id parameter is required" }, 400)
    }

    const useStream = url.searchParams.get("stream") === "1"
    const debug = url.searchParams.get("debug") === "1"

    try {
      const resolved = await resolveInput(raw)

      // Address → return list of inscription IDs for the client to choose
      if (resolved.type === "address") {
        return jsonResponse({ 
          error: "Address lookup is temporarily disabled. A decentralized UTXO indexer is required to resolve addresses to inscriptions without paid APIs." 
        }, 501)
      }

      const id = resolved.value
      const route: DiagnosticsContext["route"] = useStream ? "stream" : "standard"
      const diagnostics: DiagnosticsContext = {
        debug,
        requestId: newRequestId(),
        route,
        inscriptionId: id,
      }
      diagLog(diagnostics, "request_resolved", {
        input_type: resolved.type,
        stream: useStream,
        cache_enabled: !useStream && !debug,
      })

      // Cache check (only for non-streaming — streaming always scans fresh for progress)
      if (!useStream && !debug) {
        const cached = await cacheGet(env.CHRONICLES_KV, id)
        if (cached) {
          diagLog(diagnostics, "cache_hit", { from_cache: true })
          return jsonResponse({ ...cached, from_cache: true })
        }
        diagLog(diagnostics, "cache_miss")
      } else if (!useStream && debug) {
        diagLog(diagnostics, "cache_bypassed_debug")
      }

      // Streaming mode: SSE with progress feedback
      if (useStream) {
        return handleStreamingChronicle(id, env, diagnostics)
      }

      // Standard mode: JSON response (backward compatible)
      return handleStandardChronicle(id, env, diagnostics)
    } catch (err) {
      console.error("Chronicle API error:", err)
      const message = err instanceof Error ? err.message : "Internal error"
      const status = message.includes("not found") ? 404 : 500
      return jsonResponse({ error: message }, status)
    }
  }

  return jsonResponse({ error: "Not found" }, 404)
}

// --- UniSat enrichment orchestrator (shared by both modes) ---

async function fetchUnisatInfo(
  id: string,
  env: Env,
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

// --- Standard JSON response (backward compatible) ---

async function handleStandardChronicle(
  id: string,
  env: Env,
  diagnostics?: DiagnosticsContext
): Promise<Response> {
  // 1. Fetch inscription metadata
  let meta: InscriptionMeta
  let cborTraits: Record<string, string> | null
  try {
    const [metaRes, cborRes] = await Promise.all([
      fetchOrdinals.inscription(id),
      fetchOrdinals.metadata(id, {
        debug: diagnostics?.debug,
        requestId: diagnostics?.requestId,
      })
    ])
    meta = metaRes
    cborTraits = cborRes
    diagLog(diagnostics, "metadata_loaded", {
      inscription_number: meta.inscription_number,
      has_cbor_traits: Boolean(cborTraits),
      cbor_trait_count: cborTraits ? Object.keys(cborTraits).length : 0,
    })
  } catch {
    return jsonResponse({ error: "Inscription not found" }, 404)
  }

  // 2. Parallel fetch for transfers, collection context, genesis tx, and UniSat.
  // Collector signals run after collection context so queries can prioritize collection/item labels.
  const [transfers, collectionContext, genesisTx, unisatInfo] = await Promise.allSettled([
    fetchMempool.traceForward(meta.genesis_txid, meta.genesis_vout, { limit: 30 }),
    fetchCollectionContext(id, meta, {
      debug: diagnostics?.debug,
      requestId: diagnostics?.requestId,
    }),
    fetchMempool.tx(meta.genesis_txid),
    fetchUnisatInfo(id, env, diagnostics),
  ])
  const collectionData = collectionContext.status === "fulfilled"
    ? collectionContext.value
    : {
        mediaContext: buildMediaContext(meta),
        collectionContext: {
          protocol: { parents: null, children: null, gallery: null },
          registry: { match: null, issues: [] },
          market: { match: null, satflow_match: null, ord_net_match: null },
          profile: null,
          socials: { official_x_profiles: [] },
          presentation: { facets: [] },
        },
        sourceCatalog: [],
        collectionName: undefined,
        mentionSearchHints: {
          collectionName: undefined,
          itemName: undefined,
          officialXUrls: [],
        },
      }
  const mentionSignals = await Promise.resolve(
    collectSignals({
      inscriptionId: id,
      inscriptionNumber: meta.inscription_number,
      collectionName:
        collectionData.collectionContext.market.match?.collection_name
        ?? collectionData.mentionSearchHints.collectionName
        ?? collectionData.collectionContext.presentation.primary_label,
      itemName:
        collectionData.collectionContext.presentation.item_label
        ?? collectionData.mentionSearchHints.itemName,
      fullLabel: collectionData.collectionContext.presentation.full_label,
      officialXUrls: collectionData.mentionSearchHints.officialXUrls,
      nostrRelays: parseNostrRelays(env.NOSTR_RELAYS),
      debug: diagnostics?.debug,
      requestId: diagnostics?.requestId,
    })
  ).then((value) => ({ status: "fulfilled" as const, value }))
    .catch((reason) => ({ status: "rejected" as const, reason }))
  diagLog(diagnostics, "parallel_fetch_status", {
    transfers: transfers.status,
    collector_signals: mentionSignals.status,
    collection_context: collectionContext.status,
    genesis_tx: genesisTx.status,
    unisat: unisatInfo.status,
  })

  const enrichedTransfers = transfers.status === "fulfilled" ? transfers.value : []
  const socialMentions = mentionSignals.status === "fulfilled" ? mentionSignals.value.mentions : []
  const collectorSignals = mentionSignals.status === "fulfilled"
    ? mentionSignals.value.collectorSignals
    : {
        attention_score: 0,
        sentiment_label: "insufficient_data" as const,
        confidence: "low" as const,
        evidence_count: 0,
        provider_breakdown: { nostr: 0, bluesky: 0, x_fallback: 0, google_trends: 0 },
        scope_breakdown: {
          inscription_level: 0,
          collection_level: 0,
          mixed: 0,
          dominant_scope: "none" as const,
        },
        top_evidence: [],
        windows: {
          current_7d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" as const },
          context_30d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" as const },
        },
      }

  const info = unisatInfo.status === "fulfilled" ? unisatInfo.value : null
  const marketMatch = collectionData.collectionContext.market?.match
  const marketRarity = marketMatch?.rarity_overlay
  const rarity = buildInscriptionRarity(
    cborTraits,
    marketRarity
  )
  diagLog(diagnostics, "rarity_pipeline_summary", {
    cbor_trait_count: cborTraits ? Object.keys(cborTraits).length : 0,
    market_rarity_source: marketRarity?.source ?? null,
    market_trait_count: marketRarity?.traits.length ?? 0,
    market_rank: marketRarity?.rank ?? null,
    market_supply: marketRarity?.supply ?? null,
    rarity_trait_count: rarity?.traits.length ?? 0,
    rarity_breakdown_count: rarity?.trait_breakdown.length ?? 0,
  })

  const unisatEnrichment: UnisatEnrichment = {
    inscription_info: info,
    collection_context: null,
    market_info: { listed: false, price_sats: null, item_name: null },
    rarity,
    source_catalog: info ? [{
      source_type: "unisat_inscription_info",
      url_or_ref: `https://unisat.io/inscription/${id}`,
      trust_level: "unisat_indexer",
      fetched_at: new Date().toISOString(),
      partial: false,
    }] : []
  }

  if (rarity) {
    if (cborTraits) {
      unisatEnrichment.source_catalog.push({
        source_type: "ordinals_cbor_metadata",
        url_or_ref: `https://ordinals.com/r/metadata/${id}`,
        trust_level: "official_index",
        fetched_at: new Date().toISOString(),
        partial: false,
      })
    }
    if (marketRarity) {
      const raritySourceRef =
        marketRarity.source_ref
        ?? marketMatch.source_ref
      unisatEnrichment.source_catalog.push({
        source_type: marketRarity.source === "satflow"
          ? "satflow_rarity_stats"
          : "ord_net_rarity_overlay",
        url_or_ref: raritySourceRef,
        trust_level: "market_overlay",
        fetched_at: new Date().toISOString(),
        partial: false,
      })
    }
  }

  if (collectionData.collectionName && meta.collection) {
    meta = {
      ...meta,
      collection: {
        ...meta.collection,
        name: collectionData.collectionName,
      },
    }
  }

  const genesisOwnerAddress = genesisTx.status === "fulfilled"
    ? genesisTx.value?.vout?.[meta.genesis_vout]?.scriptpubkey_address
    : enrichedTransfers[0]?.from_address
  if (genesisOwnerAddress) {
    meta = {
      ...meta,
      genesis_owner_address: genesisOwnerAddress,
    }
  }

  // Merge UniSat charms into meta
  if (unisatEnrichment?.inscription_info?.charms) {
    meta = {
      ...meta,
      charms: mergeCharms(meta.sat_rarity, unisatEnrichment.inscription_info.charms),
    }
  }

      // Cross-source validation
  const validationUnisatInfo = unisatEnrichment?.inscription_info
    ? {
        inscriptionId: id,
        inscriptionNumber: meta.inscription_number,
        address: meta.owner_address,
        contentType: meta.content_type,
        contentLength: unisatEnrichment.inscription_info.content_length,
        height: meta.genesis_block,
        timestamp: new Date(meta.genesis_timestamp).getTime() / 1000,
        sat: unisatEnrichment.inscription_info.sat,
        genesisTransaction: meta.genesis_txid,
        offset: 0,
        charms: unisatEnrichment.inscription_info.charms,
        metaprotocol: unisatEnrichment.inscription_info.metaprotocol,
      }
    : null
  const validation = validateAcrossSources(meta, validationUnisatInfo)

  // Store validation in DB
  if (validation) {
    try {
      await db.putValidation(env.CHRONICLES_KV, {
        inscription_id: id,
        ...validation,
      })
    } catch {
      // non-blocking
    }
  }

  // 3. Build timeline (now with UniSat enrichment)
  const events = buildTimeline(meta, enrichedTransfers, socialMentions, unisatEnrichment ?? undefined)

  // Merge source catalogs
  const fetchedAt = new Date().toISOString()
  const mempoolSourceCatalog = buildMempoolSourceCatalog({
    meta,
    fetchedAt,
    transferFetchOk: transfers.status === "fulfilled",
    transferCount: enrichedTransfers.length,
    genesisTxFetched: genesisTx.status === "fulfilled" && Boolean(genesisTx.value),
  })
  const sourceCatalog = [
    ...collectionData.sourceCatalog,
    ...mempoolSourceCatalog,
    ...(mentionSignals.status === "fulfilled" ? mentionSignals.value.sourceCatalog : []),
    ...(unisatEnrichment?.source_catalog ?? []),
  ]
  const sourceSummary = summarizeSourceCatalog(sourceCatalog)
  diagLog(diagnostics, "source_catalog_summary", sourceSummary)

  const chronicle = {
    inscription_id: id,
    meta,
    events,
    collector_signals: collectorSignals,
    media_context: collectionData.mediaContext,
    collection_context: collectionData.collectionContext,
    source_catalog: sourceCatalog,
    cached_at: fetchedAt,
    unisat_enrichment: unisatEnrichment ?? undefined,
    validation,
    debug_info: diagnostics?.debug
      ? mentionSignals.status === "fulfilled"
        ? mentionSignals.value.debugInfo
        : undefined
      : undefined,
  }

  // Cache (fire-and-forget)
  try {
    await cachePut(env.CHRONICLES_KV, id, chronicle)
  } catch (cacheErr) {
    console.error("Cache write failed:", cacheErr)
    diagLog(diagnostics, "cache_write_error", {
      error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
    })
  }

  return jsonResponse(chronicle)
}

// --- SSE streaming response with progress ---

async function handleStreamingChronicle(
  id: string,
  env: Env,
  diagnostics?: DiagnosticsContext
): Promise<Response> {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const sendEvent = async (type: string, data: unknown) => {
    try {
      await writer.write(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // Writer may be closed if client disconnected
    }
  }

  // Run the pipeline in background, sending progress events
  const pipeline = (async () => {
    try {
      // Phase 1: Metadata
      await sendEvent("progress", {
        phase: "metadata",
        step: 1,
        description: "Fetching inscription data from ordinals.com…",
      })

      let meta: InscriptionMeta
      let cborTraits: Record<string, string> | null
      try {
        const [metaRes, cborRes] = await Promise.all([
          fetchOrdinals.inscription(id),
          fetchOrdinals.metadata(id, {
            debug: diagnostics?.debug,
            requestId: diagnostics?.requestId,
          })
        ])
        meta = metaRes
        cborTraits = cborRes
        diagLog(diagnostics, "stream_metadata_loaded", {
          inscription_number: meta.inscription_number,
          has_cbor_traits: Boolean(cborTraits),
          cbor_trait_count: cborTraits ? Object.keys(cborTraits).length : 0,
        })
      } catch {
        await sendEvent("error", { message: "Inscription not found" })
        return
      }

      await sendEvent("progress", {
        phase: "metadata",
        step: 2,
        description: `Found inscription #${meta.inscription_number} · sat #${meta.sat}`,
      })

      // Phase 2: Forward transfer tracking with progress
      await sendEvent("progress", {
        phase: "transfers",
        step: 0,
        description: "Starting forward transfer scan via mempool.space…",
      })

      let transferCount = 0
      const [transfers, collectionContext, genesisTx] = await Promise.all([
        fetchMempool.traceForward(meta.genesis_txid, meta.genesis_vout, {
          limit: 30,
          delayMs: 150,
          onProgress: async (step, desc) => {
            transferCount = step
            await sendEvent("progress", {
            phase: "transfers",
            step,
              description: desc,
            })
          },
        }),
        fetchCollectionContext(id, meta, {
          debug: diagnostics?.debug,
          requestId: diagnostics?.requestId,
        }),
        fetchMempool.tx(meta.genesis_txid),
      ])

      await sendEvent("progress", {
        phase: "transfers",
        step: transferCount,
        description: `Found ${transfers.length} transfer${transfers.length !== 1 ? "s" : ""} (${transfers.filter(t => t.is_sale).length} sale${transfers.filter(t => t.is_sale).length !== 1 ? "s" : ""})`,
      })

      // Phase 3: Collector signals
      await sendEvent("progress", {
        phase: "mentions",
        step: 1,
        description: "Collecting public social signals…",
      })

      let socialMentions: Awaited<ReturnType<typeof collectSignals>>["mentions"] = []
      let collectorSignals: Awaited<ReturnType<typeof collectSignals>>["collectorSignals"] = {
        attention_score: 0,
        sentiment_label: "insufficient_data",
        confidence: "low",
        evidence_count: 0,
        provider_breakdown: { nostr: 0, bluesky: 0, x_fallback: 0, google_trends: 0 },
        scope_breakdown: {
          inscription_level: 0,
          collection_level: 0,
          mixed: 0,
          dominant_scope: "none",
        },
        top_evidence: [],
        windows: {
          current_7d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
          context_30d: { evidence_count: 0, provider_count: 0, attention_score: 0, sentiment_label: "insufficient_data" },
        },
      }
      let mentionSourceCatalog: SourceCatalogItem[] = []
      let mentionDebugInfo: { mention_providers: Record<string, unknown> } | undefined
      try {
        const signalResult = await collectSignals({
          inscriptionId: id,
          inscriptionNumber: meta.inscription_number,
          collectionName:
            collectionContext.collectionContext.market.match?.collection_name
            ?? collectionContext.mentionSearchHints.collectionName
            ?? collectionContext.collectionContext.presentation.primary_label,
          itemName:
            collectionContext.collectionContext.presentation.item_label
            ?? collectionContext.mentionSearchHints.itemName,
          fullLabel: collectionContext.collectionContext.presentation.full_label,
          officialXUrls: collectionContext.mentionSearchHints.officialXUrls,
          nostrRelays: parseNostrRelays(env.NOSTR_RELAYS),
          debug: diagnostics?.debug,
          requestId: diagnostics?.requestId,
        })
        socialMentions = signalResult.mentions
        collectorSignals = signalResult.collectorSignals
        mentionSourceCatalog = signalResult.sourceCatalog
        mentionDebugInfo = signalResult.debugInfo as { mention_providers: Record<string, unknown> } | undefined
      } catch {
        // Collector signal failure is non-blocking
      }

      // Phase 4: UniSat indexer & Rarity Engine
      await sendEvent("progress", {
        phase: "unisat",
        step: 1,
        description: "Enriching traits and UniSat indexer data…",
      })

      let unisatInfo: UnisatEnrichment["inscription_info"] | null = null
      try {
        unisatInfo = await fetchUnisatInfo(id, env, diagnostics)
      } catch {
        // UniSat fetch is non-blocking
      }
      
      const marketMatch = collectionContext.collectionContext.market?.match
      const marketRarity = marketMatch?.rarity_overlay
      const rarity = buildInscriptionRarity(
        cborTraits,
        marketRarity
      )
      diagLog(diagnostics, "stream_rarity_pipeline_summary", {
        cbor_trait_count: cborTraits ? Object.keys(cborTraits).length : 0,
        market_rarity_source: marketRarity?.source ?? null,
        market_trait_count: marketRarity?.traits.length ?? 0,
        market_rank: marketRarity?.rank ?? null,
        market_supply: marketRarity?.supply ?? null,
        rarity_trait_count: rarity?.traits.length ?? 0,
      })
      
      const unisatEnrichment: UnisatEnrichment = {
        inscription_info: unisatInfo,
        collection_context: null,
        market_info: {
          listed: false,
          price_sats: null,
          item_name: null
        },
        rarity,
        source_catalog: unisatInfo ? [{
          source_type: "unisat_inscription_info",
          url_or_ref: `https://unisat.io/inscription/${id}`,
          trust_level: "unisat_indexer",
          fetched_at: new Date().toISOString(),
          partial: false,
        }] : []
      }

      if (rarity) {
        if (cborTraits) {
          unisatEnrichment.source_catalog.push({
            source_type: "ordinals_cbor_metadata",
            url_or_ref: `https://ordinals.com/r/metadata/${id}`,
            trust_level: "official_index",
            fetched_at: new Date().toISOString(),
            partial: false,
          })
        }
        if (marketRarity) {
          const raritySourceRef =
            marketRarity.source_ref
            ?? marketMatch.source_ref
          unisatEnrichment.source_catalog.push({
            source_type: marketRarity.source === "satflow"
              ? "satflow_rarity_stats"
              : "ord_net_rarity_overlay",
            url_or_ref: raritySourceRef,
            trust_level: "market_overlay",
            fetched_at: new Date().toISOString(),
            partial: false,
          })
        }
      }

      if (rarity?.rarity_rank) {
        await sendEvent("progress", {
          phase: "unisat",
          step: 2,
          description: `Rarity rank #${rarity.rarity_rank} of ${rarity.total_supply} (top ${rarity.rarity_percentile}%)`,
        })
      } else if (rarity?.traits && rarity.traits.length > 0) {
        await sendEvent("progress", {
          phase: "unisat",
          step: 2,
          description: `Found ${rarity.traits.length} traits`,
        })
      } else {
        await sendEvent("progress", {
          phase: "unisat",
          step: 2,
          description: unisatInfo ? "UniSat indexer data loaded" : "No rarity or indexer data found",
        })
      }

      // Phase 5: Build timeline
      await sendEvent("progress", {
        phase: "complete",
        step: 1,
        description: "Building timeline…",
      })

      if (collectionContext.collectionName && meta.collection) {
        meta = {
          ...meta,
          collection: {
            ...meta.collection,
            name: collectionContext.collectionName,
          },
        }
      }

      const genesisOwnerAddress = genesisTx?.vout?.[meta.genesis_vout]?.scriptpubkey_address
        ?? transfers[0]?.from_address
      if (genesisOwnerAddress) {
        meta = {
          ...meta,
          genesis_owner_address: genesisOwnerAddress,
        }
      }

      // Merge UniSat charms
      if (unisatEnrichment?.inscription_info?.charms) {
        meta = {
          ...meta,
          charms: mergeCharms(meta.sat_rarity, unisatEnrichment.inscription_info.charms),
        }
      }

      // Cross-source validation
      const validationUnisatInfo = unisatEnrichment?.inscription_info
        ? {
            inscriptionId: id,
            inscriptionNumber: meta.inscription_number,
            address: meta.owner_address,
            contentType: meta.content_type,
            contentLength: unisatEnrichment.inscription_info.content_length,
            height: meta.genesis_block,
            timestamp: new Date(meta.genesis_timestamp).getTime() / 1000,
            sat: unisatEnrichment.inscription_info.sat,
            genesisTransaction: meta.genesis_txid,
            offset: 0,
            charms: unisatEnrichment.inscription_info.charms,
            metaprotocol: unisatEnrichment.inscription_info.metaprotocol,
          }
        : null
      const validation = validateAcrossSources(meta, validationUnisatInfo)

      const events = buildTimeline(meta, transfers, socialMentions, unisatEnrichment ?? undefined)

      // Merge source catalogs
      const fetchedAt = new Date().toISOString()
      const mempoolSourceCatalog = buildMempoolSourceCatalog({
        meta,
        fetchedAt,
        transferFetchOk: true,
        transferCount: transfers.length,
        genesisTxFetched: Boolean(genesisTx),
      })
      const sourceCatalog = [
        ...collectionContext.sourceCatalog,
        ...mempoolSourceCatalog,
        ...mentionSourceCatalog,
        ...(unisatEnrichment?.source_catalog ?? []),
      ]
      diagLog(diagnostics, "stream_source_catalog_summary", summarizeSourceCatalog(sourceCatalog))

      const chronicle = {
        inscription_id: id,
        meta,
        events,
        collector_signals: collectorSignals,
        media_context: collectionContext.mediaContext,
        collection_context: collectionContext.collectionContext,
        source_catalog: sourceCatalog,
        cached_at: fetchedAt,
        unisat_enrichment: unisatEnrichment ?? undefined,
        validation,
        debug_info: diagnostics?.debug
          ? mentionDebugInfo
          : undefined,
      }

      // Cache (fire-and-forget)
      try {
        await cachePut(env.CHRONICLES_KV, id, chronicle)
      } catch {
        // Cache failure is non-blocking
      }

      // Send final result
      await sendEvent("result", chronicle)
    } catch (err) {
      diagLog(diagnostics, "stream_pipeline_error", {
        error: err instanceof Error ? err.message : String(err),
      })
      await sendEvent("error", {
        message: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      try {
        await writer.close()
      } catch {
        // Already closed
      }
    }
  })()

  // Ensure the pipeline runs to completion even after returning the response
  // In Cloudflare Workers, use waitUntil if available; otherwise the stream keeps the connection alive
  void pipeline

  return new Response(readable, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}
