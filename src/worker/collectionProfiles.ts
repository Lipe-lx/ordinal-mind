import type {
  CollectionMarketStats,
  CollectionProfile,
  CollectionProfileFact,
  SourceCatalogItem,
} from "../app/lib/types"

const SATFLOW_ORDINALS_BASE_URL = "https://www.satflow.com/ordinals"

interface CuratedCollectionProfileSource {
  source_type: string
  url_or_ref: string
  detail: string
}

interface CuratedCollectionProfileEntry {
  slug: string
  aliases: string[]
  name: string
  summary: string
  creators: CollectionProfileFact[]
  milestones: CollectionProfileFact[]
  collector_signals: CollectionProfileFact[]
  sources: CuratedCollectionProfileSource[]
}

const RUNES_LEGACY_RUNESTONE = "https://www.runeslegacy.com/project/runestone"
const CMC_RUNESTONE =
  "https://coinmarketcap.com/academy/article/bitcoin-ordinals-runestone-up-for-auction-ahead-of-airdrop"
const SATFLOW_RUNESTONE = `${SATFLOW_ORDINALS_BASE_URL}/runestone`

const CURATED_COLLECTION_PROFILES: CuratedCollectionProfileEntry[] = [
  {
    slug: "runestone",
    aliases: ["runestone", "runestones"],
    name: "Runestone",
    summary:
      "Runestone is treated as a major Ordinals-era collector artifact because its public history combines an unusually broad airdrop, large on-chain inscription scale, and explicit links to the Runes launch narrative.",
    creators: [
      { label: "Initiator", value: "Leonidas", source_ref: RUNES_LEGACY_RUNESTONE },
      { label: "Artist", value: "Leo Caillard", source_ref: RUNES_LEGACY_RUNESTONE },
      { label: "Inscription platform", value: "OrdinalsBot", source_ref: RUNES_LEGACY_RUNESTONE },
      { label: "Mining collaborator", value: "Marathon Digital Holdings", source_ref: RUNES_LEGACY_RUNESTONE },
    ],
    milestones: [
      {
        label: "Distribution design",
        value: "Designed as an airdrop to 112,383 wallets, with eligibility tied to wallets holding three inscriptions at block 826,600 and specific format exclusions.",
        source_ref: RUNES_LEGACY_RUNESTONE,
      },
      {
        label: "Scale",
        value: "The parent inscription and Runestone inscription were described as two of the largest inscriptions made at the time, each nearly 3.97 MB.",
        source_ref: RUNES_LEGACY_RUNESTONE,
      },
      {
        label: "Auction funding",
        value: "The pre-airdrop auction proceeds were described as funding the network fees for the airdrop and flowing to Bitcoin miners.",
        source_ref: CMC_RUNESTONE,
      },
      {
        label: "Runes link",
        value: "The collection was publicly framed around a future Runes token claim timed with the Runes protocol launch near the April 2024 halving.",
        source_ref: CMC_RUNESTONE,
      },
    ],
    collector_signals: [
      {
        label: "Fair-distribution signal",
        value: "Public coverage emphasized no team allocation or pre-sale and an open-source eligibility algorithm designed not to favor whales.",
        source_ref: CMC_RUNESTONE,
      },
      {
        label: "Satflow market index",
        value: "Satflow tracks Runestone as a Bitcoin Ordinals collection with live floor price, supply, holders, listing, orderbook, and activity data.",
        source_ref: SATFLOW_RUNESTONE,
      },
    ],
    sources: [
      {
        source_type: "collection_profile_runes_legacy",
        url_or_ref: RUNES_LEGACY_RUNESTONE,
        detail: "Runestone project history and initiator roles",
      },
      {
        source_type: "collection_profile_coinmarketcap",
        url_or_ref: CMC_RUNESTONE,
        detail: "Public coverage of Runestone auction, airdrop, and distribution claims",
      },
    ],
  },
]

export function buildCuratedCollectionProfile(args: {
  slug: string
  name: string
  fetchedAt: string
  fallbackSourceRef: string
  marketStats: CollectionMarketStats | null
}): CollectionProfile | null {
  const entry = findCuratedCollectionProfile(args.slug)
  if (!entry) return null

  return {
    name: args.name,
    slug: args.slug,
    summary: entry.summary,
    creators: entry.creators,
    milestones: entry.milestones,
    collector_signals: [
      ...entry.collector_signals,
      {
        label: "Protocol provenance",
        value:
          "When this item has a parent link, treat that on-chain parent relationship as stronger provenance than any market or registry overlay.",
        source_ref: args.fallbackSourceRef,
      },
    ],
    market_stats: args.marketStats ?? undefined,
    sources: entry.sources.map((source): SourceCatalogItem => ({
      source_type: source.source_type,
      url_or_ref: source.url_or_ref,
      trust_level: "curated_public_research",
      fetched_at: args.fetchedAt,
      partial: false,
      detail: source.detail,
    })),
  }
}

export function hasCuratedCollectionProfile(slug: string): boolean {
  return Boolean(findCuratedCollectionProfile(slug))
}

function findCuratedCollectionProfile(slug: string): CuratedCollectionProfileEntry | null {
  const normalized = normalizeCollectionSlug(slug)
  return CURATED_COLLECTION_PROFILES.find((entry) =>
    [entry.slug, ...entry.aliases].some((alias) => normalizeCollectionSlug(alias) === normalized)
  ) ?? null
}

function normalizeCollectionSlug(slug: string): string {
  return slug.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
}
