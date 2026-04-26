import type {
  CollectorSignals,
  MentionProviderAttempt,
  MentionProviderDebug,
  SocialMention,
  SocialSignalProvider,
  SourceCatalogItem,
} from "../../../app/lib/types"
import type { MentionQuerySpec } from "./queryBuilder"

export interface MentionSearchInput {
  inscriptionId: string
  inscriptionNumber?: number
  collectionName?: string
  itemName?: string
  fullLabel?: string
  officialXUrls?: string[]
  enableTrends?: boolean
  debug?: boolean
  requestId?: string
  nostrRelays?: string[]
}

export interface MentionProviderResult {
  mentions: SocialMention[]
  sourceCatalog: SourceCatalogItem[]
}

export interface MentionProviderContext extends MentionSearchInput {
  queries: MentionQuerySpec[]
  diagnostics?: MentionProviderDebug
}

export interface MentionCollectionResult {
  mentions: SocialMention[]
  collectorSignals: CollectorSignals
  sourceCatalog: SourceCatalogItem[]
  debugInfo?: {
    mention_providers: Partial<Record<SocialSignalProvider, MentionProviderDebug>>
  }
}

export function createProviderDebug(
  provider: SocialSignalProvider,
  input: MentionSearchInput,
  queries: MentionQuerySpec[]
): MentionProviderDebug {
  return {
    provider,
    collection_name: input.collectionName,
    item_name: input.itemName,
    official_x_urls: input.officialXUrls ? [...input.officialXUrls] : undefined,
    queries: queries.map((query) => query.text),
    attempts: [],
    notes: [],
  }
}

export function recordAttempt(
  diagnostics: MentionProviderDebug | undefined,
  attempt: MentionProviderAttempt
): void {
  diagnostics?.attempts.push(attempt)
}
