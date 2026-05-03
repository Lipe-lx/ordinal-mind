import type {
  InscriptionMeta,
  ChronicleEvent,
  CollectorSignals,
  SocialMention,
  SourceCatalogItem,
  UnisatEnrichment,
  WebResearchContext,
  DataValidationResult,
  InscriptionRarity,
  Chronicle,
} from "../../app/lib/types"
import type { CollectionContextFetchResult } from "../agents/collections"
import type { EnrichedTransfer } from "../agents/mempool"

export interface DiagnosticsContext {
  debug: boolean
  requestId: string
  route: "standard" | "stream"
  inscriptionId: string
}

export interface PhaseTrace {
  name: string
  started_at: string
  completed_at: string
  duration_ms: number
  status: "ok" | "partial" | "failed"
  detail?: Record<string, unknown>
}

export interface PipelineTrace {
  request_id: string
  inscription_id: string
  phases: PhaseTrace[]
  total_duration_ms: number
}

export type ProgressCallback = (
  phase: string,
  step: number,
  description: string
) => Promise<void>

export interface ChronicleState {
  // Input (set once at init)
  inscriptionId: string
  env: {
    CHRONICLES_KV: KVNamespace
    UNISAT_API_KEY?: string
    DB?: D1Database
  }
  diagnostics: DiagnosticsContext
  lite: boolean
  onProgress?: ProgressCallback

  // Phase 1: Metadata
  meta: InscriptionMeta | null
  cborTraits: Record<string, string> | null

  // Phase 2: Parallel fetch
  transfers: EnrichedTransfer[]
  collectionData: CollectionContextFetchResult | null
  genesisTxResult: { vout: { scriptpubkey_address?: string; value: number }[] } | null
  genesisTxFetched: boolean
  transfersFetched: boolean

  // Phase 3: Dependent fetch (mentions + lore)
  mentions: SocialMention[]
  collectorSignals: CollectorSignals
  mentionSourceCatalog: SourceCatalogItem[]
  mentionDebugInfo: { mention_providers: Record<string, unknown> } | undefined
  webResearch: WebResearchContext | null

  // Phase 4: Enrichment (unisat + rarity + validation)
  unisatEnrichment: UnisatEnrichment | null
  rarity: InscriptionRarity | null
  validation: DataValidationResult | null

  // Phase 5: Output
  events: ChronicleEvent[]
  sourceCatalog: SourceCatalogItem[]
  chronicle: Chronicle | null

  // Observability
  trace: PipelineTrace
}
