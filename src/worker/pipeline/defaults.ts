import type {
  CollectorSignals,
  UnisatEnrichment,
  InscriptionMeta,
} from "../../app/lib/types"
import type { CollectionContextFetchResult } from "../agents/collections"
import { buildMediaContext } from "../agents/collections"

export function emptyCollectorSignals(): CollectorSignals {
  return {
    attention_score: 0,
    sentiment_label: "insufficient_data",
    confidence: "low",
    evidence_count: 0,
    provider_breakdown: { google_trends: 0 },
    scope_breakdown: {
      inscription_level: 0,
      collection_level: 0,
      mixed: 0,
      dominant_scope: "none",
    },
    top_evidence: [],
    windows: {
      current_7d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
      context_30d: {
        evidence_count: 0,
        provider_count: 0,
        attention_score: 0,
        sentiment_label: "insufficient_data",
      },
    },
  }
}

export function fallbackCollectionData(
  meta: InscriptionMeta
): CollectionContextFetchResult {
  return {
    mediaContext: buildMediaContext(meta),
    collectionContext: {
      protocol: {
        parents: null,
        children: null,
        grandchildren: null,
        gallery: null,
        grandparents: null,
        greatGrandparents: null,
      },
      registry: { match: null, issues: [] },
      market: {
        match: null,
        satflow_match: null,
        ord_net_match: null,
        preferred_description: null,
        satflow_description: null,
        ord_net_description: null,
      },
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
}

export function emptyUnisatEnrichment(
  inscriptionId: string,
  info: UnisatEnrichment["inscription_info"] | null,
  rarity: UnisatEnrichment["rarity"]
): UnisatEnrichment {
  return {
    inscription_info: info,
    collection_context: null,
    market_info: { listed: false, price_sats: null, item_name: null },
    rarity,
    source_catalog: info
      ? [
          {
            source_type: "unisat_inscription_info",
            url_or_ref: `https://unisat.io/inscription/${inscriptionId}`,
            trust_level: "unisat_indexer",
            fetched_at: new Date().toISOString(),
            partial: false,
          },
        ]
      : [],
  }
}
