import { db } from "./db"
import { persistRawEvents } from "./wiki/persistEvents"
import {
  fetchMetadata,
  parallelFetch,
  dependentFetch,
  enrichment,
  buildOutput,
} from "./pipeline/phases"
import { emptyCollectorSignals } from "./pipeline/defaults"
import type {
  ChronicleState,
  DiagnosticsContext,
  ProgressCallback,
} from "./pipeline/types"
import type { Env } from "./index"

export function newRequestId(): string {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

export function initState(
  id: string,
  env: Env,
  diagnostics: DiagnosticsContext,
  lite: boolean,
  onProgress?: ProgressCallback
): ChronicleState {
  return {
    inscriptionId: id,
    env: {
      CHRONICLES_KV: env.CHRONICLES_KV,
      UNISAT_API_KEY: env.UNISAT_API_KEY,
      DB: env.DB,
    },
    diagnostics,
    lite,
    onProgress,
    meta: null,
    cborTraits: null,
    transfers: [],
    collectionData: null,
    genesisTxResult: null,
    genesisTxFetched: false,
    transfersFetched: false,
    skippedTransferCount: 0,
    headTransferCount: 0,
    mentions: [],
    collectorSignals: emptyCollectorSignals(),
    mentionSourceCatalog: [],
    mentionDebugInfo: undefined,
    webResearch: null,
    unisatEnrichment: null,
    rarity: null,
    validation: null,
    events: [],
    sourceCatalog: [],
    chronicle: null,
    trace: {
      request_id: diagnostics.requestId,
      inscription_id: id,
      phases: [],
      total_duration_ms: 0,
    },
  }
}

export async function runPipeline(state: ChronicleState): Promise<ChronicleState> {
  state = await fetchMetadata(state)
  state = await parallelFetch(state)
  state = await dependentFetch(state)
  state = await enrichment(state)
  state = await buildOutput(state)
  return state
}

export async function runChroniclePipeline(options: {
  id: string
  env: Env
  diagnostics: DiagnosticsContext
  lite: boolean
  onProgress?: ProgressCallback
  persistToDb?: boolean
  writeCache?: boolean
  writeValidation?: boolean
}): Promise<ChronicleState> {
  const state = initState(
    options.id,
    options.env,
    options.diagnostics,
    options.lite,
    options.onProgress
  )
  const result = await runPipeline(state)

  if (!result.chronicle) {
    throw new Error("Pipeline produced no output")
  }

  if (options.persistToDb !== false && options.env.DB) {
    void persistRawEvents(options.env, options.id, result.events).then((r) => {
      if (!r.ok) {
        console.warn(`Raw events persistence skipped: ${r.status}`)
      }
    })
  }

  // Manual caching removed to save KV write quota.
  // We still read from cache in index.ts if available, but we stop writing new entries here.
  /*
  if (options.writeCache !== false && !options.lite) {
    try {
      await cachePut(options.env.CHRONICLES_KV, options.id, result.chronicle)
    } catch (cacheErr) {
      console.error("Cache write failed:", cacheErr)
    }
  }
  */

  if (options.writeValidation !== false && result.validation) {
    try {
      await db.putValidation(options.env.CHRONICLES_KV, {
        inscription_id: options.id,
        ...result.validation,
      })
    } catch {
      // Non-blocking
    }
  }

  return result
}
