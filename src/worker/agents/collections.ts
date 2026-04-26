import type {
  CollectionContext,
  CollectionMarketStats,
  CollectionPresentationFacet,
  CollectionProfile,
  CuratedRegistryMatch,
  InscriptionMeta,
  MarketOverlayMatch,
  MediaContext,
  ProtocolGalleryContext,
  ProtocolRelationSet,
  RelatedInscriptionSummary,
  SourceCatalogItem,
} from "../../app/lib/types"
import {
  buildOrdinalsPreviewUrl,
  detectMediaKind,
  getMediaFallbackReason,
} from "../../app/lib/media"
import { buildCuratedCollectionProfile } from "../collectionProfiles"

const ORDINALS_BASE_URL = "https://ordinals.com"
const VERIFIED_REGISTRY_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections.json"
const NEEDS_INFO_REGISTRY_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections-needs-info.json"
const LEGACY_COLLECTIONS_BASE_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/legacy/collections"
const ORD_MARKET_BASE_URL = "https://ord.net"
const SATFLOW_ORDINALS_BASE_URL = "https://www.satflow.com/ordinals"
const SATFLOW_ORDINAL_BASE_URL = "https://www.satflow.com/ordinal"
const COINGECKO_NFT_API_BASE_URL = "https://api.coingecko.com/api/v3/nfts"

const MAX_PARENT_ITEMS = 10
const MAX_CHILD_ITEMS = 20
const MAX_GALLERY_ITEMS = 20

interface OrdInscriptionDetails {
  id: string
  number: number
  content_type?: string
  height?: number
  timestamp?: number
  parents?: string[]
  children?: string[]
  properties?: {
    attributes?: {
      title?: string
    }
    gallery?: {
      id: string
      attributes?: {
        title?: string
      }
    }[]
  }
}

interface RecursiveInscriptionSummary {
  id: string
  number?: number
  content_type?: string
  height?: number
  timestamp?: number
}

interface ParentInscriptionsResponse {
  parents?: RecursiveInscriptionSummary[]
  more?: boolean
  page?: number
}

interface ChildInscriptionsResponse {
  children?: RecursiveInscriptionSummary[]
  more?: boolean
  page?: number
}

interface GalleryResponse {
  ids?: string[]
  more?: boolean
  page?: number
}

interface LegacyCollectionItem {
  id: string
  meta?: {
    name?: string
  }
}

interface CoinGeckoNftResponse {
  id?: string
  name?: string
  links?: {
    homepage?: string
    twitter?: string
    discord?: string
  }
}

export interface OrdNetCollectionDirectoryEntry {
  name: string
  slug: string
  section: "popular" | "trending" | "recently_verified"
  rank?: number
  volume_24h?: string
  supply?: string
  source_ref: string
}

type RegistryEntry =
  | {
      name: string
      type: "gallery"
      id: string
      slug: string
      issues?: string[]
    }
  | {
      name: string
      type: "parent"
      ids: string[]
      slug: string
      issues?: string[]
    }

export interface CollectionContextFetchResult {
  mediaContext: MediaContext
  collectionContext: CollectionContext
  sourceCatalog: SourceCatalogItem[]
  collectionName?: string
  mentionSearchHints: {
    collectionName?: string
    itemName?: string
    officialXUrls: string[]
  }
}

interface CollectionDiagnosticsOptions {
  debug?: boolean
  requestId?: string
}

export async function fetchCollectionContext(
  inscriptionId: string,
  meta: InscriptionMeta,
  diagnostics?: CollectionDiagnosticsOptions
): Promise<CollectionContextFetchResult> {
  const fetchedAt = new Date().toISOString()
  const sourceCatalog: SourceCatalogItem[] = []
  const mediaContext = buildMediaContext(meta)

  const selfDetails = await fetchOptionalJson<OrdInscriptionDetails>(
    `${ORDINALS_BASE_URL}/inscription/${inscriptionId}`,
    {
      sourceCatalog,
      sourceType: "protocol_inscription",
      urlOrRef: `${ORDINALS_BASE_URL}/inscription/${inscriptionId}`,
      trustLevel: "official_index",
      fetchedAt,
      detail: "ord server inscription JSON",
    }
  )

  const [parents, children] = await Promise.all([
    fetchProtocolRelations(
      `${ORDINALS_BASE_URL}/r/parents/${inscriptionId}/inscriptions`,
      "parents",
      MAX_PARENT_ITEMS,
      fetchedAt,
      sourceCatalog
    ),
    fetchProtocolRelations(
      `${ORDINALS_BASE_URL}/r/children/${inscriptionId}/inscriptions`,
      "children",
      MAX_CHILD_ITEMS,
      fetchedAt,
      sourceCatalog
    ),
  ])

  const [protocolGallery, ordNetOverlay, satflowOverlay] = await Promise.all([
    fetchProtocolGallery(inscriptionId, selfDetails, fetchedAt, sourceCatalog),
    fetchMarketOverlay(inscriptionId, fetchedAt, sourceCatalog, diagnostics),
    fetchSatflowInscriptionOverlay(inscriptionId, fetchedAt, sourceCatalog, diagnostics)
  ])
  
  const marketOverlay = mergeMarketOverlays(satflowOverlay, ordNetOverlay)
  debugCollection(diagnostics, inscriptionId, "overlay_resolution", {
    satflow_overlay: Boolean(satflowOverlay),
    ord_net_overlay: Boolean(ordNetOverlay),
    selected_overlay: marketOverlay?.source_ref.includes("satflow.com")
      ? "satflow"
      : marketOverlay
        ? "ord_net"
        : "none",
    selected_slug: marketOverlay?.collection_slug ?? null,
    satflow_rarity_rank: satflowOverlay?.rarity_overlay?.rank ?? null,
    satflow_rarity_trait_count: satflowOverlay?.rarity_overlay?.traits.length ?? 0,
    ord_net_rarity_trait_count: ordNetOverlay?.rarity_overlay?.traits.length ?? 0,
    selected_rarity_source:
      marketOverlay?.rarity_overlay?.source ?? "none",
    selected_rarity_trait_count: marketOverlay?.rarity_overlay?.traits.length ?? 0,
  })
  const ordNetDirectoryMatch = marketOverlay
    ? await fetchOrdNetCollectionDirectoryMatch(marketOverlay, fetchedAt, sourceCatalog)
    : null
  const [satflowPageData, ordNetOfficialXProfiles, coinGeckoOfficialXProfiles] = await Promise.all([
    marketOverlay?.collection_slug
      ? fetchSatflowCollectionPageData(marketOverlay.collection_slug, fetchedAt, sourceCatalog, diagnostics)
      : Promise.resolve({ stats: null, officialXProfiles: [] as Array<{ url: string; source_ref: string }> }),
    marketOverlay?.collection_href
      ? fetchOrdNetCollectionOfficialXUrls(
          marketOverlay.collection_href,
          {
            collectionSlug: marketOverlay.collection_slug,
            collectionName: marketOverlay.collection_name,
          },
          fetchedAt,
          sourceCatalog,
          diagnostics
        )
      : Promise.resolve([] as Array<{ url: string; source_ref: string }>),
    marketOverlay?.collection_slug
      ? fetchCoinGeckoCollectionOfficialXUrls(
          marketOverlay.collection_slug,
          fetchedAt,
          sourceCatalog,
          diagnostics
        )
      : Promise.resolve([] as Array<{ url: string; source_ref: string }>),
  ])
  const satflowStats = satflowPageData.stats
  const officialXProfiles = dedupeOfficialXProfiles([
    ...satflowPageData.officialXProfiles,
    ...ordNetOfficialXProfiles,
    ...coinGeckoOfficialXProfiles,
  ])
  debugCollection(diagnostics, inscriptionId, "market_stats_resolution", {
    has_satflow_stats: Boolean(satflowStats),
    satflow_stats_supply: satflowStats?.supply ?? null,
    satflow_stats_listed: satflowStats?.listed ?? null,
    has_ord_net_directory_match: Boolean(ordNetDirectoryMatch),
  })
  const registry = await fetchRegistryOverlay(
    inscriptionId,
    selfDetails,
    parents,
    protocolGallery,
    marketOverlay,
    fetchedAt,
    sourceCatalog
  )
  const profile = buildCollectionProfile(registry.match, marketOverlay, satflowStats, ordNetDirectoryMatch, fetchedAt)
  appendUniqueSourceCatalogItems(sourceCatalog, profile?.sources ?? [])
  const partialSources = sourceCatalog.filter((source) => source.partial)
  debugCollection(diagnostics, inscriptionId, "collection_context_assembled", {
    has_registry_match: Boolean(registry.match),
    has_profile: Boolean(profile),
    source_count: sourceCatalog.length,
    partial_source_count: partialSources.length,
    partial_sources: partialSources.map((source) => source.source_type),
  })

  const collectionContext: CollectionContext = {
    protocol: {
      parents,
      children,
      gallery: protocolGallery,
    },
    registry,
    market: {
      match: marketOverlay,
      satflow_match: satflowOverlay,
      ord_net_match: ordNetOverlay,
    },
    profile,
    socials: {
      official_x_profiles: officialXProfiles,
    },
    presentation: buildPresentation(
      selfDetails,
      parents,
      children,
      protocolGallery,
      registry.match,
      marketOverlay,
      satflowOverlay,
      ordNetOverlay,
      satflowStats,
      ordNetDirectoryMatch
    ),
  }

  const collectionName =
    registry.match?.match_type === "parent" && parents && parents.items.length > 0
      ? registry.match.matched_collection
      : undefined

  return {
    mediaContext,
    collectionContext,
    sourceCatalog,
    collectionName,
    mentionSearchHints: {
      collectionName: resolvedCollectionNameForMentions(
        registry.match?.matched_collection,
        marketOverlay?.collection_name,
        selfDetails?.properties?.attributes?.title
      ),
      itemName: marketOverlay?.item_name ?? selfDetails?.properties?.attributes?.title,
      officialXUrls: officialXProfiles.map((profile) => profile.url),
    },
  }
}

function debugCollection(
  diagnostics: CollectionDiagnosticsOptions | undefined,
  inscriptionId: string,
  event: string,
  data: Record<string, unknown>
): void {
  if (!diagnostics?.debug) return
  console.info(`[CollectionDiag] ${JSON.stringify({
    at: new Date().toISOString(),
    request_id: diagnostics.requestId ?? null,
    inscription_id: inscriptionId,
    event,
    ...data,
  })}`)
}

function appendUniqueSourceCatalogItems(
  sourceCatalog: SourceCatalogItem[],
  items: SourceCatalogItem[]
): void {
  for (const item of items) {
    const exists = sourceCatalog.some((source) =>
      source.source_type === item.source_type && source.url_or_ref === item.url_or_ref
    )
    if (!exists) sourceCatalog.push(item)
  }
}

export function buildMediaContext(meta: InscriptionMeta): MediaContext {
  const kind = detectMediaKind(meta.content_type)
  const previewUrl = buildOrdinalsPreviewUrl(meta.inscription_id)

  if (kind === "image") {
    return {
      kind,
      content_type: meta.content_type,
      content_url: meta.content_url,
      preview_url: previewUrl,
      vision_eligible: true,
      vision_transport: "public_url",
    }
  }

  return {
    kind,
    content_type: meta.content_type,
    content_url: meta.content_url,
    preview_url: previewUrl,
    vision_eligible: false,
    vision_transport: "unsupported",
    fallback_reason: getMediaFallbackReason(kind),
  }
}

async function fetchProtocolRelations(
  url: string,
  kind: "parents" | "children",
  limit: number,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<ProtocolRelationSet | null> {
  const data = await fetchOptionalJson<ParentInscriptionsResponse | ChildInscriptionsResponse>(url, {
    sourceCatalog,
    sourceType: `protocol_${kind}`,
    urlOrRef: url,
    trustLevel: "canonical_onchain",
    fetchedAt,
    detail: `Recursive ${kind} endpoint`,
  })

  if (!data) return null

  const rawItems =
    kind === "parents"
      ? (data as ParentInscriptionsResponse).parents ?? []
      : (data as ChildInscriptionsResponse).children ?? []

  return {
    items: rawItems.slice(0, limit).map(toRelatedInscriptionSummary),
    total_count: rawItems.length,
    more: data.more ?? false,
    source_ref: url,
    partial: (data.more ?? false) || rawItems.length > limit,
  }
}

async function fetchProtocolGallery(
  inscriptionId: string,
  selfDetails: OrdInscriptionDetails | null,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<ProtocolGalleryContext | null> {
  if (!selfDetails?.properties?.gallery?.length) return null

  const url = `${ORDINALS_BASE_URL}/gallery/${inscriptionId}`
  const galleryPage = await fetchOptionalJson<GalleryResponse>(url, {
    sourceCatalog,
    sourceType: "protocol_gallery",
    urlOrRef: url,
    trustLevel: "official_index",
    fetchedAt,
    detail: "Gallery page 0",
  })

  if (!galleryPage) return null

  const ids = (galleryPage.ids ?? []).slice(0, MAX_GALLERY_ITEMS)
  const details = ids.length > 0
    ? await fetchOptionalJson<OrdInscriptionDetails[]>(
        `${ORDINALS_BASE_URL}/inscriptions`,
        {
          method: "POST",
          body: JSON.stringify(ids),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
        {
          sourceCatalog,
          sourceType: "protocol_gallery_items",
          urlOrRef: `${ORDINALS_BASE_URL}/inscriptions`,
          trustLevel: "official_index",
          fetchedAt,
          detail: "Gallery sample inscription details",
        }
      )
    : []

  return {
    gallery_id: inscriptionId,
    items: (details ?? []).slice(0, MAX_GALLERY_ITEMS).map(toRelatedInscriptionSummary),
    total_count: (galleryPage.ids ?? []).length,
    more: galleryPage.more ?? false,
    source_ref: url,
    partial: (galleryPage.more ?? false) || (galleryPage.ids ?? []).length > MAX_GALLERY_ITEMS,
  }
}

async function fetchRegistryOverlay(
  inscriptionId: string,
  selfDetails: OrdInscriptionDetails | null,
  parents: ProtocolRelationSet | null,
  gallery: ProtocolGalleryContext | null,
  marketOverlay: MarketOverlayMatch | null,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<CollectionContext["registry"]> {
  const [verified, needsInfo] = await Promise.all([
    fetchOptionalJson<unknown>(VERIFIED_REGISTRY_URL, {
      sourceCatalog,
      sourceType: "curated_registry_verified",
      urlOrRef: VERIFIED_REGISTRY_URL,
      trustLevel: "curated_public_registry",
      fetchedAt,
      detail: "Verified collection registry",
    }),
    fetchOptionalJson<unknown>(NEEDS_INFO_REGISTRY_URL, {
      sourceCatalog,
      sourceType: "curated_registry_needs_info",
      urlOrRef: NEEDS_INFO_REGISTRY_URL,
      trustLevel: "curated_public_registry",
      fetchedAt,
      detail: "Collections with unresolved registry issues",
    }),
  ])

  const verifiedEntries = parseRegistryEntries(verified, "verified")
  const needsInfoEntries = parseRegistryEntries(needsInfo, "needs_info")
  const directMatch = selectRegistryMatch({
    inscriptionId,
    parentIds: new Set([
      ...(selfDetails?.parents ?? []),
      ...(parents?.items.map((item) => item.inscription_id) ?? []),
    ]),
    galleryId: gallery?.gallery_id,
    verifiedEntries,
    needsInfoEntries,
  })

  if (directMatch) {
    return {
      match: directMatch,
      issues: directMatch.issues ?? [],
    }
  }

  const marketBackedMatch = await selectRegistryMatchFromMarketOverlay(
    inscriptionId,
    marketOverlay,
    verifiedEntries,
    needsInfoEntries,
    fetchedAt,
    sourceCatalog
  )

  return {
    match: marketBackedMatch?.match ?? null,
    issues: marketBackedMatch?.issues ?? [],
  }
}

function buildPresentation(
  selfDetails: OrdInscriptionDetails | null,
  parents: ProtocolRelationSet | null,
  children: ProtocolRelationSet | null,
  gallery: ProtocolGalleryContext | null,
  registryMatch: CuratedRegistryMatch | null,
  marketMatch: MarketOverlayMatch | null,
  satflowMatch: MarketOverlayMatch | null,
  ordNetMatch: MarketOverlayMatch | null,
  satflowStats: CollectionMarketStats | null,
  ordNetDirectoryMatch: OrdNetCollectionDirectoryEntry | null
): CollectionContext["presentation"] {
  const facets: CollectionPresentationFacet[] = []

  if (ordNetMatch) {
    facets.push({
      label: ordNetMatch.verified ? "ord.net verified overlay" : "ord.net overlay",
      value: ordNetMatch.collection_name,
      tone: "overlay",
      detail: ordNetMatch.item_name
        ? `${ordNetMatch.item_name} · ${ordNetMatch.collection_slug}`
        : ordNetMatch.collection_slug,
    })
  }

  if (satflowMatch) {
    facets.push({
      label: "Satflow overlay",
      value: satflowMatch.collection_name,
      tone: "overlay",
      detail: satflowMatch.item_name
        ? `${satflowMatch.item_name} · ${satflowMatch.collection_slug}`
        : satflowMatch.collection_slug,
    })
  }

  if (registryMatch) {
    facets.push({
      label: registryMatch.quality_state === "verified" ? "Verified Collection" : "Curated Match",
      value: registryMatch.matched_collection,
      tone: registryMatch.quality_state === "verified" ? "curated" : "partial",
      detail: `${registryMatch.match_type} · ${registryMatch.slug}`,
    })
  }

  if (parents && parents.items.length > 0) {
    facets.push({
      label: "Parent provenance",
      value: summarizeCount(parents.total_count, parents.more, "parent"),
      tone: parents.partial ? "partial" : "canonical",
      detail: parents.items
        .slice(0, 2)
        .map((item) =>
          item.inscription_number != null ? `#${item.inscription_number}` : shortenInscriptionId(item.inscription_id)
        )
        .join(" · "),
    })
  }

  if (gallery) {
    facets.push({
      label: "Gallery provenance",
      value: summarizeCount(gallery.total_count, gallery.more, "item"),
      tone: gallery.partial ? "partial" : "canonical",
      detail:
        selfDetails?.properties?.attributes?.title ??
        `Gallery ${shortenInscriptionId(gallery.gallery_id)}`,
    })
  }

  if (children && children.items.length > 0) {
    facets.push({
      label: "Children",
      value: summarizeCount(children.total_count, children.more, "child"),
      tone: children.partial ? "partial" : "canonical",
    })
  }

  if (registryMatch?.issues.length) {
    facets.push({
      label: "Registry notes",
      value: `${registryMatch.issues.length} open issue${registryMatch.issues.length > 1 ? "s" : ""}`,
      tone: "partial",
      detail: registryMatch.issues.join(" · "),
    })
  }

  if (satflowStats?.supply) {
    facets.push({
      label: "Market supply",
      value: satflowStats.supply,
      tone: "overlay",
      detail: "Satflow public collection index",
    })
  }

  if (satflowStats?.listed) {
    facets.push({
      label: "Listed",
      value: satflowStats.listed,
      tone: "overlay",
      detail: satflowStats.floor_price ? `floor ${satflowStats.floor_price}` : "Satflow public listing data",
    })
  }

  if (ordNetDirectoryMatch) {
    facets.push({
      label: "ord.net index",
      value: formatOrdNetSection(ordNetDirectoryMatch.section),
      tone: "overlay",
      detail: ordNetDirectoryMatch.rank
        ? `rank #${ordNetDirectoryMatch.rank}`
        : "public marketplace collection directory",
    })
  }

  const mergedFacets: CollectionPresentationFacet[] = []
  for (const f of facets) {
    const existing = mergedFacets.find(m => m.label === f.label)
    if (existing) {
      if (existing.value !== f.value) {
        existing.value = `${existing.value} / ${f.value}`
      }
      if (existing.detail !== f.detail) {
        existing.detail = `${existing.detail} | ${f.detail}`
      }
      if (f.tone === "curated" || f.tone === "canonical") {
        existing.tone = f.tone
      }
    } else {
      mergedFacets.push(f)
    }
  }

  // Prefer a human-readable collection name. ord.net sometimes returns
  // a parent inscription ref like "#124517225" instead of the real name.
  // Satflow typically has the proper collection name (e.g., "Pupsogette").
  const resolvedCollectionName =
    registryMatch?.matched_collection ??
    pickReadableCollectionName(ordNetMatch?.collection_name, satflowMatch?.collection_name) ??
    marketMatch?.collection_name ??
    selfDetails?.properties?.attributes?.title

  const itemLabel =
    ordNetMatch?.item_name ??
    satflowMatch?.item_name ??
    selfDetails?.properties?.attributes?.title

  let fullLabel = itemLabel
  if (resolvedCollectionName && itemLabel) {
    if (!itemLabel.toLowerCase().startsWith(resolvedCollectionName.toLowerCase())) {
      fullLabel = `${resolvedCollectionName} • ${itemLabel}`
    }
  } else if (resolvedCollectionName) {
    fullLabel = resolvedCollectionName
  }

  return {
    primary_label: resolvedCollectionName,
    item_label: itemLabel,
    full_label: fullLabel,
    facets: mergedFacets,
  }
}

function resolvedCollectionNameForMentions(
  registryName: string | undefined,
  marketName: string | undefined,
  fallbackTitle: string | undefined
): string | undefined {
  return registryName ?? marketName ?? fallbackTitle
}

/**
 * Returns the most human-readable collection name between two overlay sources.
 * ord.net sometimes returns a parent inscription ref like "#124517225" or
 * "p-124517225" as the collection name; satflow usually has the real name.
 */
function pickReadableCollectionName(
  ordNetName: string | undefined,
  satflowName: string | undefined
): string | undefined {
  const isParentRef = (name: string) => /^[#p]-?\d+$/.test(name.trim())

  if (ordNetName && !isParentRef(ordNetName)) return ordNetName
  if (satflowName && !isParentRef(satflowName)) return satflowName
  return ordNetName ?? satflowName
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function dedupeOfficialXProfiles(
  profiles: Array<{ url: string; source_ref: string }>
): Array<{ url: string; source_ref: string }> {
  const seen = new Set<string>()
  const result: Array<{ url: string; source_ref: string }> = []

  for (const profile of profiles) {
    if (!profile.url || seen.has(profile.url)) continue
    seen.add(profile.url)
    result.push(profile)
  }

  return result
}


export function buildCollectionProfile(
  registryMatch: CuratedRegistryMatch | null,
  marketMatch: MarketOverlayMatch | null,
  marketStats: CollectionMarketStats | null,
  ordNetDirectoryMatch: OrdNetCollectionDirectoryEntry | null,
  fetchedAt: string
): CollectionProfile | null {
  const slug = marketMatch?.collection_slug ?? registryMatch?.slug
  const name = registryMatch?.matched_collection ?? marketMatch?.collection_name

  if (!slug || !name) return null

  const sourceRef = marketStats?.source_ref ?? marketMatch?.source_ref ?? registryMatch?.source_ref ?? slug
  const sources: SourceCatalogItem[] = []

  if (marketStats) {
    sources.push({
      source_type: "market_collection_satflow",
      url_or_ref: marketStats.source_ref,
      trust_level: "market_overlay",
      fetched_at: fetchedAt,
      partial: false,
      detail: "Satflow public collection stats",
    })
  }

  const curated = buildCuratedCollectionProfile({
    slug,
    name,
    fetchedAt,
    fallbackSourceRef: sourceRef,
    marketStats,
  })
  if (curated) {
    return {
      ...curated,
      collector_signals: [
        ...curated.collector_signals,
        ...buildSatflowMarketSignals(marketStats),
        ...buildOrdNetDirectorySignals(ordNetDirectoryMatch),
      ],
      sources: [...curated.sources, ...sources],
    }
  }

  return {
    name,
    slug,
    summary: "Collection context was found through public collection indexes. No curated historical profile is available yet.",
    creators: [],
    milestones: [],
    collector_signals: [
      {
        label: "Collection match",
        value: marketMatch?.verified
          ? "Matched through a verified public market overlay."
          : "Matched through public market or registry metadata.",
        source_ref: sourceRef,
      },
      ...buildSatflowMarketSignals(marketStats),
      ...buildOrdNetDirectorySignals(ordNetDirectoryMatch),
    ],
    market_stats: marketStats ?? undefined,
    sources,
  }
}

function buildSatflowMarketSignals(
  stats: CollectionMarketStats | null
): CollectionProfile["collector_signals"] {
  if (!stats) return []

  const values = [
    stats.floor_price ? `floor ${stats.floor_price}` : null,
    stats.change_7d ? `7D change ${stats.change_7d}` : null,
    stats.volume_7d ? `7D volume ${stats.volume_7d}` : null,
    stats.supply ? `supply ${stats.supply}` : null,
    stats.listed ? `listed ${stats.listed}` : null,
    stats.market_cap ? `market cap ${stats.market_cap}` : null,
  ].filter(Boolean)

  if (values.length === 0) return []

  return [
    {
      label: "Satflow collection market",
      value: values.join(" · "),
      source_ref: stats.source_ref,
    },
  ]
}

function buildOrdNetDirectorySignals(
  entry: OrdNetCollectionDirectoryEntry | null
): CollectionProfile["collector_signals"] {
  if (!entry) return []

  return [
    {
      label: "ord.net collection directory",
      value: [
        `Appears in the ord.net ${formatOrdNetSection(entry.section)} collection index`,
        entry.rank ? `rank #${entry.rank}` : null,
        entry.volume_24h ? `24h volume ${entry.volume_24h}` : null,
        entry.supply ? `supply ${entry.supply}` : null,
      ].filter(Boolean).join(" · "),
      source_ref: entry.source_ref,
    },
  ]
}

function formatOrdNetSection(section: OrdNetCollectionDirectoryEntry["section"]): string {
  return section.replaceAll("_", " ")
}

async function fetchOrdNetCollectionDirectoryMatch(
  marketOverlay: MarketOverlayMatch,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<OrdNetCollectionDirectoryEntry | null> {
  const html = await fetchOptionalText(ORD_MARKET_BASE_URL, {
    sourceCatalog,
    sourceType: "market_collection_directory_ord_net",
    urlOrRef: ORD_MARKET_BASE_URL,
    trustLevel: "market_overlay",
    fetchedAt,
    detail: "ord.net public collection directory",
  })

  if (!html) return null

  const entries = parseOrdNetCollectionDirectory(html, ORD_MARKET_BASE_URL)
  const targetSlug = normalizeCollectionSlug(marketOverlay.collection_slug)
  const targetName = normalizeCollectionSlug(marketOverlay.collection_name)

  return entries.find((entry) =>
    normalizeCollectionSlug(entry.slug) === targetSlug ||
    normalizeCollectionSlug(entry.name) === targetName
  ) ?? null
}


async function fetchSatflowCollectionPageData(
  slug: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[],
  diagnostics?: CollectionDiagnosticsOptions
): Promise<{
  stats: CollectionMarketStats | null
  officialXProfiles: Array<{ url: string; source_ref: string }>
}> {
  const normalizedSlug = slug.toLowerCase().replaceAll("_", "-")
  const url = `${SATFLOW_ORDINALS_BASE_URL}/${encodeURIComponent(normalizedSlug)}`
  const html = await fetchOptionalText(url, {
    sourceCatalog,
    sourceType: "market_collection_satflow",
    urlOrRef: url,
    trustLevel: "market_overlay",
    fetchedAt,
    detail: "Satflow public collection page",
  })

  if (!html) {
    debugCollection(diagnostics, slug, "satflow_collection_stats_missing", {
      collection_slug: normalizedSlug,
    })
    return { stats: null, officialXProfiles: [] }
  }

  const stats = parseSatflowCollectionStats(html, url)
  const officialXProfiles = parseOfficialXProfileLinks(html, {
    collectionSlug: normalizedSlug,
    collectionName: slug,
  }).map((profileUrl) => ({
    url: profileUrl,
    source_ref: url,
  }))
  debugCollection(diagnostics, slug, "satflow_collection_stats_parsed", {
    collection_slug: normalizedSlug,
    has_stats: Boolean(stats),
    supply: stats?.supply ?? null,
    listed: stats?.listed ?? null,
    floor_price: stats?.floor_price ?? null,
    official_x_count: officialXProfiles.length,
  })
  return { stats, officialXProfiles }
}

async function fetchOrdNetCollectionOfficialXUrls(
  collectionHref: string,
  hints: {
    collectionSlug?: string
    collectionName?: string
  },
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[],
  diagnostics?: CollectionDiagnosticsOptions
): Promise<Array<{ url: string; source_ref: string }>> {
  const url = toAbsoluteOrdNetUrl(collectionHref)
  if (!url) return []

  const html = await fetchOptionalText(url, {
    sourceCatalog,
    sourceType: "market_collection_ord_net",
    urlOrRef: url,
    trustLevel: "market_overlay",
    fetchedAt,
    detail: "ord.net collection page",
  })

  if (!html) return []

  const officialXProfiles = parseOfficialXProfileLinks(html, {
    collectionSlug: hints.collectionSlug,
    collectionName: hints.collectionName,
  }).map((profileUrl) => ({
    url: profileUrl,
    source_ref: url,
  }))
  debugCollection(diagnostics, collectionHref, "ord_net_collection_page_parsed", {
    source_ref: url,
    official_x_count: officialXProfiles.length,
  })
  return officialXProfiles
}

async function fetchCoinGeckoCollectionOfficialXUrls(
  collectionSlug: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[],
  diagnostics?: CollectionDiagnosticsOptions
): Promise<Array<{ url: string; source_ref: string }>> {
  const normalizedSlug = collectionSlug.toLowerCase().replaceAll("_", "-")
  const url = `${COINGECKO_NFT_API_BASE_URL}/${encodeURIComponent(normalizedSlug)}`
  const payload = await fetchOptionalJson<CoinGeckoNftResponse>(url, {
    sourceCatalog,
    sourceType: "public_collection_coingecko",
    urlOrRef: url,
    trustLevel: "curated_public_research",
    fetchedAt,
    detail: "CoinGecko public NFT collection metadata",
  })

  const officialXProfiles = payload
    ? parseCoinGeckoNftOfficialXProfiles(payload, url)
    : []

  debugCollection(diagnostics, collectionSlug, "coingecko_collection_metadata_parsed", {
    source_ref: url,
    has_payload: Boolean(payload),
    official_x_count: officialXProfiles.length,
  })

  return officialXProfiles
}

export function parseCoinGeckoNftOfficialXProfiles(
  payload: CoinGeckoNftResponse,
  sourceRef: string
): Array<{ url: string; source_ref: string }> {
  const twitterUrl = payload.links?.twitter
  const normalized = twitterUrl ? normalizeXProfileUrl(twitterUrl) : null
  return normalized ? [{ url: normalized, source_ref: sourceRef }] : []
}

async function fetchMarketOverlay(
  inscriptionId: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[],
  diagnostics?: CollectionDiagnosticsOptions
): Promise<MarketOverlayMatch | null> {
  const url = `${ORD_MARKET_BASE_URL}/inscription/${inscriptionId}`
  const html = await fetchOptionalText(url, {
    sourceCatalog,
    sourceType: "market_overlay_ord_net",
    urlOrRef: url,
    trustLevel: "market_overlay",
    fetchedAt,
    detail: "ord.net inscription overlay",
  })

  if (!html) {
    debugCollection(diagnostics, inscriptionId, "ord_net_overlay_missing", {})
    return null
  }

  const overlay = parseOrdMarketOverlay(html, url)
  debugCollection(diagnostics, inscriptionId, "ord_net_overlay_parsed", {
    has_overlay: Boolean(overlay),
    collection_slug: overlay?.collection_slug ?? null,
    rarity_trait_count: overlay?.rarity_overlay?.traits.length ?? 0,
    rarity_supply: overlay?.rarity_overlay?.supply ?? null,
  })
  return overlay
}

async function fetchSatflowInscriptionOverlay(
  inscriptionId: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[],
  diagnostics?: CollectionDiagnosticsOptions
): Promise<MarketOverlayMatch | null> {
  const url = `${SATFLOW_ORDINAL_BASE_URL}/${inscriptionId}`
  const html = await fetchOptionalText(url, {
    sourceCatalog,
    sourceType: "market_overlay_satflow",
    urlOrRef: url,
    trustLevel: "market_overlay",
    fetchedAt,
    detail: "Satflow individual inscription overlay",
  })

  if (!html) {
    debugCollection(diagnostics, inscriptionId, "satflow_overlay_missing", {})
    return null
  }

  const overlay = parseSatflowInscriptionOverlay(html, url)
  debugCollection(diagnostics, inscriptionId, "satflow_overlay_parsed", {
    has_overlay: Boolean(overlay),
    collection_slug: overlay?.collection_slug ?? null,
    rarity_rank: overlay?.rarity_overlay?.rank ?? null,
    rarity_trait_count: overlay?.rarity_overlay?.traits.length ?? 0,
    rarity_supply: overlay?.rarity_overlay?.supply ?? null,
  })
  return overlay
}

export function parseSatflowInscriptionOverlay(
  html: string,
  sourceRef: string
): MarketOverlayMatch | null {
  const ogTitle = html.match(
    /og:title["']?\s*content=["']([^"']+)["']/
  )?.[1]

  if (!ogTitle || ogTitle.startsWith("Ordinal ")) return null

  const titleParts = ogTitle.split(" - ")
  let collectionName: string
  let itemName: string | undefined

  if (titleParts.length >= 2) {
    itemName = titleParts[0].trim()
    collectionName = titleParts.slice(1).join(" - ").trim()
  } else {
    collectionName = ogTitle.trim()
  }

  if (!collectionName) return null

  const collectionSlug = extractSatflowCollectionSlug(html, collectionName)
  if (!collectionSlug) return null

  const rarity_overlay = extractSatflowRarity(html)
  if (rarity_overlay) {
    rarity_overlay.source_ref = sourceRef
  }

  return {
    collection_slug: collectionSlug,
    collection_name: collectionName,
    collection_href: `/ordinals/${collectionSlug}`,
    item_name: itemName,
    verified: false,
    source_ref: sourceRef,
    rarity_overlay,
  }
}

export async function selectRegistryMatchFromMarketOverlay(
  inscriptionId: string,
  marketOverlay: MarketOverlayMatch | null,
  verifiedEntries: RegistryEntry[],
  needsInfoEntries: RegistryEntry[],
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<{ match: CuratedRegistryMatch | null; issues: string[] } | null> {
  if (!marketOverlay?.collection_slug) return null

  const qualitySets: Array<{
    qualityState: "verified" | "needs_info"
    entries: RegistryEntry[]
    sourceRef: string
  }> = [
    {
      qualityState: "verified",
      entries: verifiedEntries,
      sourceRef: VERIFIED_REGISTRY_URL,
    },
    {
      qualityState: "needs_info",
      entries: needsInfoEntries,
      sourceRef: NEEDS_INFO_REGISTRY_URL,
    },
  ]

  for (const { qualityState, entries, sourceRef } of qualitySets) {
    const entry = entries.find((candidate) => candidate.slug === marketOverlay.collection_slug)
    if (!entry) continue

    const legacyMembership = await fetchLegacyCollectionMembership(
      entry.slug,
      inscriptionId,
      fetchedAt,
      sourceCatalog
    )

    if (legacyMembership.status === "confirmed") {
      const match = toRegistryMatch(
        entry,
        qualityState,
        legacyMembership.source_ref ?? sourceRef
      )

      return {
        match,
        issues: qualityState === "needs_info"
          ? match.issues
          : [],
      }
    }

    return {
      match: null,
      issues: [
        legacyMembership.status === "missing"
          ? `The curated registry slug "${entry.slug}" does not include this inscription in its legacy item list.`
          : `The curated registry slug "${entry.slug}" could not be cross-checked against its legacy item list.`,
      ],
    }
  }

  return null
}

async function fetchLegacyCollectionMembership(
  slug: string,
  inscriptionId: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<
  | { status: "confirmed"; source_ref: string; item_name?: string }
  | { status: "missing"; source_ref: string }
  | { status: "unavailable"; source_ref?: string }
> {
  const sourceRef = `${LEGACY_COLLECTIONS_BASE_URL}/${slug}.json`
  const items = await fetchOptionalJson<unknown>(sourceRef, {
    sourceCatalog,
    sourceType: "curated_registry_legacy_collection",
    urlOrRef: sourceRef,
    trustLevel: "curated_public_registry",
    fetchedAt,
    detail: `Legacy collection items for ${slug}`,
  })

  if (!items) {
    return { status: "unavailable", source_ref: sourceRef }
  }

  const membership = findLegacyCollectionMembership(items, inscriptionId)
  if (!membership) {
    return { status: "missing", source_ref: sourceRef }
  }

  return {
    status: "confirmed",
    source_ref: sourceRef,
    item_name: membership.item_name,
  }
}

export function findLegacyCollectionMembership(
  raw: unknown,
  inscriptionId: string
): { inscription_id: string; item_name?: string } | null {
  if (!Array.isArray(raw)) return null

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue

    const candidate = entry as LegacyCollectionItem
    if (candidate.id !== inscriptionId) continue

    return {
      inscription_id: candidate.id,
      item_name: candidate.meta?.name,
    }
  }

  return null
}

export function parseOrdMarketOverlay(
  html: string,
  sourceRef = `${ORD_MARKET_BASE_URL}/inscription`
): MarketOverlayMatch | null {
  const payload = normalizeOrdNetPayload(html)
  const collectionSlug = payload.match(/"?collection"?:"([^"]+)"/)?.[1]
    ?? payload.match(/"?verifiedCollections"?:\[\{[\s\S]*?"?slug"?:"([^"]+)"/)?.[1]
  const collectionHref = payload.match(/"?collectionHref"?:"([^"]+)"/)?.[1]
    ?? payload.match(/"?verifiedCollections"?:\[\{[\s\S]*?"?href"?:"([^"]+)"/)?.[1]
  const collectionName = payload.match(/"?collection"?:\{[\s\S]*?"?name"?:"([^"]+)"/)?.[1]
    ?? payload.match(/"?verifiedCollections"?:\[\{[\s\S]*?"?name"?:"([^"]+)"/)?.[1]
  const itemName = payload.match(/"?item"?:\{[\s\S]*?"?name"?:"([^"]+)"/)?.[1]
    ?? payload.match(/<title>([^<]+)<\/title>/)?.[1]
  const ownerAddress = payload.match(/"?item"?:\{[\s\S]*?"?owner"?:"([^"]+)"/)?.[1]
  const verifiedMatch = payload.match(/"?collection"?:\{[\s\S]*?"?verified"?:(true|false)/)?.[1]
    ?? (payload.includes("verifiedCollections:[{") ? "true" : undefined)
  const ordNetRarity = extractOrdNetVerifiedGalleryTraits(payload, sourceRef)

  if (!collectionSlug || !collectionHref || !collectionName) return null
  if (collectionName.toLowerCase() === "uncategorized" || collectionSlug.toLowerCase() === "uncategorized") return null

  return {
    collection_slug: collectionSlug,
    collection_name: collectionName,
    collection_href: collectionHref,
    item_name: itemName,
    verified: verifiedMatch === "true",
    owner_address: ownerAddress,
    source_ref: sourceRef,
    rarity_overlay: ordNetRarity,
  }
}

function normalizeOrdNetPayload(html: string): string {
  return html
    .replace(/&quot;/g, "\"")
    .replace(/\\"/g, "\"")
}

export function parseSatflowCollectionStats(
  html: string,
  sourceRef: string
): CollectionMarketStats | null {
  const floorPriceRaw = extractMetricNumber(html, ["floorPrice", "floor_price"])
  const change7dRaw = extractMetricNumber(html, ["priceChangePercent7d", "change7d"])
  const volume7dRaw = extractMetricNumber(html, ["volume7D", "volume_7d"])
  const supplyRaw = extractMetricNumber(html, ["totalSupply", "supply"])
  const listedRaw = extractMetricNumber(html, ["listedCount", "listed", "activeListings", "listedItems"])
  const marketCapRaw = extractMetricNumber(html, ["marketCap", "market_cap"])

  const labelChange = extractLabeledStatValue(html, "7D Change")
  const labelVolume = extractLabeledStatValue(html, "7D Volume")
  const labelSupply = extractLabeledStatValue(html, "Supply")
  const labelListed = extractLabeledStatValue(html, "Listed")
  const labelMarketCap = extractLabeledStatValue(html, "Market Cap")

  const stats: CollectionMarketStats = {
    source_ref: sourceRef,
    floor_price: floorPriceRaw != null ? formatBtc(floorPriceRaw) : undefined,
    change_7d: change7dRaw != null ? formatPercent(change7dRaw) : normalizePercentString(labelChange),
    volume_7d: volume7dRaw != null ? formatBtc(volume7dRaw) : normalizeNumericLabel(labelVolume),
    supply: supplyRaw != null ? formatCompactCount(supplyRaw) : normalizeNumericLabel(labelSupply),
    listed: listedRaw != null ? formatIntegerCount(listedRaw) : normalizeNumericLabel(labelListed),
    market_cap: marketCapRaw != null ? formatBtc(marketCapRaw) : normalizeNumericLabel(labelMarketCap),
  }

  const hasAnyValue = Object.entries(stats).some(
    ([key, value]) => key !== "source_ref" && typeof value === "string" && value.length > 0
  )

  return hasAnyValue ? stats : null
}

function extractSatflowRarity(
  html: string
): MarketOverlayMatch["rarity_overlay"] | undefined {
  try {
    const rank = extractMetricInteger(html, ["rarityRank"]) ?? 0
    const rawAttributes = selectBestSatflowAttributeArray(html)

    const traits = (rawAttributes ?? [])
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null
        const candidate = entry as Record<string, unknown>
        const key = typeof candidate.key === "string" ? candidate.key : null
        const value = candidate.value
        const tokenCount =
          typeof candidate.tokenCount === "number"
            ? candidate.tokenCount
            : typeof candidate.count === "number"
              ? candidate.count
              : null

        if (!key || value === undefined || value === null) return null

        return {
          key,
          value: String(value),
          tokenCount: tokenCount ?? 0,
        }
      })
      .filter((trait): trait is { key: string; value: string; tokenCount: number } => Boolean(trait))

    const explicitSupply = extractMetricInteger(html, ["totalSupply"])
    const supplyFromAttributes = traits.find(
      (trait) => trait.key.toLowerCase() === "attributes" && trait.tokenCount > 0
    )?.tokenCount
    const supply = explicitSupply ?? supplyFromAttributes
    const usefulTraits = traits.filter((trait) => trait.key.trim().length > 0)

    if (rank === 0 && usefulTraits.length === 0 && supply == null) return undefined

    return {
      source: "satflow",
      rank,
      supply,
      source_ref: undefined,
      traits: usefulTraits,
    }
  } catch (e) {
    console.error("[Satflow] Failed to parse rarity from HTML", e)
    return undefined
  }
}

function selectBestSatflowAttributeArray(html: string): unknown[] | null {
  const candidates = extractJsonArraysForKey(html, "attributes")
  if (candidates.length === 0) return null

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreSatflowAttributeArray(candidate),
    }))
    .sort((left, right) => right.score - left.score)

  return scored[0]?.candidate ?? null
}

function scoreSatflowAttributeArray(candidate: unknown[]): number {
  let populatedTraits = 0
  let countedTraits = 0

  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") continue
    const item = entry as Record<string, unknown>
    const key = typeof item.key === "string" ? item.key : null
    const value = item.value
    const count =
      typeof item.tokenCount === "number"
        ? item.tokenCount
        : typeof item.count === "number"
          ? item.count
          : null

    if (key && value !== undefined && value !== null) populatedTraits += 1
    // Counted traits are only useful when they also have key + value.
    if (count != null && count > 0 && key && value !== undefined && value !== null) countedTraits += 1
  }

  return countedTraits * 100 + populatedTraits
}

function extractSatflowCollectionSlug(html: string, collectionName: string): string | null {
  const slugFromPayload = extractMetricString(html, ["collectionSlug"])
  if (slugFromPayload) return slugFromPayload

  const hrefMatches = [...html.matchAll(/\/ordinals\/([a-z0-9][a-z0-9-_]{1,80})/gi)]
    .map((match) => match[1])
    .filter(Boolean)

  if (hrefMatches.length === 0) return null

  const uniqueCandidates = [...new Set(hrefMatches)]
  const targetSlug = slugifyCollectionName(collectionName)
  const normalizedTarget = normalizeCollectionSlug(targetSlug)

  const exactMatch = uniqueCandidates.find(
    (candidate) => normalizeCollectionSlug(candidate) === normalizedTarget
  )
  if (exactMatch) return exactMatch

  const blocked = new Set(["ordinals", "ordinal", "collections", "trending", "new", "activity"])
  return uniqueCandidates.find((candidate) => !blocked.has(candidate.toLowerCase())) ?? uniqueCandidates[0] ?? null
}

export function parseOfficialXProfileLinks(
  html: string,
  hints?: {
    collectionSlug?: string
    collectionName?: string
  }
): string[] {
  const hrefLinks = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlHref(match[1] ?? ""))
  const rawLinks = [...html.matchAll(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}(?:[/?#"'\\<\s]|$)/gi)]
    .map((match) => match[0].replace(/["'\\<\s]+$/g, ""))

  const links = [...new Set([...hrefLinks, ...rawLinks])]
    .map((raw) => normalizeXProfileUrl(raw, hints))
    .filter((value): value is string => Boolean(value))

  return uniqueStrings(links)
}

function decodeHtmlHref(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
}

function normalizeXProfileUrl(
  rawUrl: string,
  hints?: {
    collectionSlug?: string
    collectionName?: string
  }
): string | null {
  try {
    if (!rawUrl) return null
    const url = rawUrl.startsWith("//")
      ? new URL(`https:${rawUrl}`)
      : rawUrl.startsWith("/")
        ? null
        : new URL(rawUrl)
    if (!url) return null

    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase()
    if (hostname !== "x.com" && hostname !== "twitter.com") return null

    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length === 0) return null

    const username = parts[0]
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return null
    if (["home", "search", "explore", "intent", "share", "i", "hashtag"].includes(username.toLowerCase())) {
      return null
    }
    if (isPlatformHandle(username)) return null
    if (hints && !matchesCollectionIdentity(username, hints)) return null

    return `https://x.com/${username}`
  } catch {
    return null
  }
}

function isPlatformHandle(username: string): boolean {
  return new Set([
    "satflow",
    "ordnet",
    "ord_net",
    "ordinals",
    "ordinalscom",
    "thewizardsoford",
    "ordinalswallet",
  ]).has(username.toLowerCase())
}

function matchesCollectionIdentity(
  username: string,
  hints: {
    collectionSlug?: string
    collectionName?: string
  }
): boolean {
  const normalizedHandle = normalizeSocialIdentity(username)
  const normalizedSlug = normalizeSocialIdentity(hints.collectionSlug)
  const normalizedName = normalizeSocialIdentity(hints.collectionName)

  if (normalizedSlug && normalizedHandle === normalizedSlug) return true
  if (normalizedName && normalizedHandle === normalizedName) return true
  if (normalizedSlug && normalizedHandle.includes(normalizedSlug)) return true
  if (normalizedName && normalizedHandle.includes(normalizedName)) return true

  const tokens = tokenizeSocialIdentity([
    hints.collectionSlug ?? "",
    hints.collectionName ?? "",
  ].join(" "))
  return tokens.some((token) => token.length >= 5 && normalizedHandle.includes(token))
}

function normalizeSocialIdentity(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function tokenizeSocialIdentity(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
}

function toAbsoluteOrdNetUrl(collectionHref: string): string | null {
  try {
    return new URL(collectionHref, ORD_MARKET_BASE_URL).toString()
  } catch {
    return null
  }
}

function extractJsonArraysForKey(html: string, key: string): unknown[][] {
  const keyPatterns = [`"${key}":`, `\\"${key}\\":`]
  const matches: unknown[][] = []

  for (const marker of keyPatterns) {
    let cursor = 0
    while (cursor < html.length) {
      const markerIndex = html.indexOf(marker, cursor)
      if (markerIndex === -1) break

      const openBracket = html.indexOf("[", markerIndex + marker.length)
      if (openBracket === -1) break

      const arrayLiteral = extractBalancedJsonArray(html, openBracket)
      if (arrayLiteral) {
        const parsed = parseJsonArrayLiteral(arrayLiteral)
        if (parsed) matches.push(parsed)
      }

      cursor = openBracket + 1
    }
  }

  return matches
}

function extractOrdNetVerifiedGalleryTraits(
  html: string,
  sourceRef: string
): MarketOverlayMatch["rarity_overlay"] | undefined {
  const marker = "verifiedGalleryTraitGroups:"
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) return undefined

  const openBracket = html.indexOf("[", markerIndex + marker.length)
  if (openBracket === -1) return undefined

  const arrayLiteral = extractBalancedJsonArray(html, openBracket)
  if (!arrayLiteral) return undefined

  const traits: Array<{ key: string; value: string; tokenCount: number }> = []
  for (const match of arrayLiteral.matchAll(/type:"([^"]+)",value:"([^"]+)",count:(\d+)/g)) {
    const [, key, value, countRaw] = match
    const tokenCount = Number.parseInt(countRaw, 10)
    if (!key || !value || Number.isNaN(tokenCount)) continue
    traits.push({ key, value, tokenCount })
  }

  if (traits.length === 0) return undefined

  return {
    source: "ord_net",
    rank: 0,
    supply: extractLooseIntegerMetric(html, ["totalSupply", "items"]) ?? undefined,
    source_ref: sourceRef,
    traits,
  }
}

function extractLooseIntegerMetric(html: string, keys: string[]): number | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(`"${escaped}"\\s*:\\s*"?(-?\\d+)"?`, "i"),
      new RegExp(`\\\\?"${escaped}\\\\?"\\s*:\\s*\\\\?"?(-?\\d+)\\\\?"?`, "i"),
      new RegExp(`${escaped}:\\s*(-?\\d+)`, "i"),
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (!match?.[1]) continue
      const value = Number.parseInt(match[1], 10)
      if (!Number.isNaN(value)) return value
    }
  }

  return null
}

function mergeMarketOverlays(
  satflowOverlay: MarketOverlayMatch | null,
  ordNetOverlay: MarketOverlayMatch | null
): MarketOverlayMatch | null {
  if (!satflowOverlay) return ordNetOverlay
  if (!ordNetOverlay) return satflowOverlay

  const satflowTraits = satflowOverlay.rarity_overlay?.traits.length ?? 0
  const ordNetTraits = ordNetOverlay.rarity_overlay?.traits.length ?? 0
  const rarity =
    satflowTraits > 0
      ? satflowOverlay.rarity_overlay
      : ordNetTraits > 0
        ? ordNetOverlay.rarity_overlay
        : satflowOverlay.rarity_overlay ?? ordNetOverlay.rarity_overlay

  // Provenance/identity should prefer ord.net when it exists because it is the
  // collection directory/verification layer. Satflow can still provide richer
  // rarity/frequency data through the selected rarity overlay above.
  return {
    collection_slug: ordNetOverlay.collection_slug || satflowOverlay.collection_slug,
    collection_name: ordNetOverlay.collection_name || satflowOverlay.collection_name,
    collection_href: ordNetOverlay.collection_href || satflowOverlay.collection_href,
    item_name: ordNetOverlay.item_name || satflowOverlay.item_name,
    verified: ordNetOverlay.verified || satflowOverlay.verified,
    owner_address: ordNetOverlay.owner_address || satflowOverlay.owner_address,
    source_ref: ordNetOverlay.source_ref,
    rarity_overlay: rarity,
  }
}

function extractBalancedJsonArray(text: string, startIndex: number): string | null {
  if (text[startIndex] !== "[") return null

  let depth = 0
  let inString = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]

    if (ch === "\"" && !isEscapedQuote(text, i)) {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === "[") {
      depth += 1
      continue
    }

    if (ch === "]") {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIndex, i + 1)
      }
    }
  }

  return null
}

function isEscapedQuote(text: string, index: number): boolean {
  let backslashCount = 0
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashCount += 1
  }
  return backslashCount % 2 === 1
}

function parseJsonArrayLiteral(arrayLiteral: string): unknown[] | null {
  const candidates = [
    arrayLiteral,
    arrayLiteral.replace(/\\"/g, "\""),
  ]

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // keep trying fallbacks
    }
  }

  return null
}

function extractMetricNumber(html: string, keys: string[]): number | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(`"${escaped}"\\s*:\\s*"?(-?\\d+(?:\\.\\d+)?)"?`, "i"),
      new RegExp(`\\\\?"${escaped}\\\\?"\\s*:\\s*\\\\?"?(-?\\d+(?:\\.\\d+)?)\\\\?"?`, "i"),
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (!match?.[1]) continue
      const value = Number.parseFloat(match[1])
      if (!Number.isNaN(value)) return value
    }
  }
  return null
}

function extractMetricInteger(html: string, keys: string[]): number | null {
  const value = extractMetricNumber(html, keys)
  if (value == null) return null
  return Math.trunc(value)
}

function extractMetricString(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, "i"),
      new RegExp(`\\\\?"${escaped}\\\\?"\\s*:\\s*\\\\?"([^\\\\"]+)\\\\?"`, "i"),
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) return match[1]
    }
  }
  return null
}

function extractLabeledStatValue(html: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const directRegex = new RegExp(
    `<span[^>]*>\\s*${escapedLabel}\\s*<\\/span>\\s*<[^>]*>\\s*([^<]+?)\\s*<\\/[^>]+>`,
    "i"
  )
  const directMatch = html.match(directRegex)?.[1]?.trim()
  if (directMatch) return directMatch

  const readable = toReadableText(html)
  const textRegex = new RegExp(`${escapedLabel}\\s+([A-Za-z0-9.+%\\-]+)`, "i")
  return readable.match(textRegex)?.[1]?.trim()
}

function normalizeNumericLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!/^-?\d[\d,.]*([KMB])?$/i.test(trimmed)) return undefined
  return trimmed.toUpperCase()
}

function normalizePercentString(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return trimmed
  const normalized = normalizeNumericLabel(trimmed)
  if (!normalized) return undefined
  return `${normalized}%`
}

function formatBtc(value: number): string {
  if (value < 0.0001) return value.toPrecision(2)
  return Number.parseFloat(value.toFixed(4)).toString()
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000_000) return `${Number.parseFloat((value / 1_000_000_000).toFixed(1))}B`
  if (value >= 1_000_000) return `${Number.parseFloat((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number.parseFloat((value / 1_000).toFixed(1))}K`
  return Math.trunc(value).toString()
}

function formatIntegerCount(value: number): string {
  return Math.trunc(value).toString()
}

export function parseOrdNetCollectionDirectory(
  html: string,
  sourceRef: string
): OrdNetCollectionDirectoryEntry[] {
  const text = toReadableText(html)
  const entries = [
    ...parseOrdNetNamedSection(text, "Popular", "Trending", "popular", sourceRef),
    ...parseOrdNetTrendingSection(text, sourceRef),
    ...parseOrdNetNamedSection(text, "Recently Verified", "Floor", "recently_verified", sourceRef),
  ]

  const unique = new Map<string, OrdNetCollectionDirectoryEntry>()
  for (const entry of entries) {
    const key = `${entry.section}:${normalizeCollectionSlug(entry.name)}`
    if (!unique.has(key)) unique.set(key, entry)
  }

  return [...unique.values()]
}

function parseOrdNetNamedSection(
  text: string,
  startLabel: string,
  endLabel: string,
  section: OrdNetCollectionDirectoryEntry["section"],
  sourceRef: string
): OrdNetCollectionDirectoryEntry[] {
  const sectionText = sliceBetweenLabels(text, startLabel, endLabel)
  if (!sectionText) return []

  const names = sectionText
    .split(/\s+(?:Popular|Floor|Listed|24h|—)+\s+/)
    .map((value) => value.trim())
    .filter((value) => looksLikeCollectionName(value))

  return names.map((name) => ({
    name,
    slug: slugifyCollectionName(name),
    section,
    source_ref: sourceRef,
  }))
}

function parseOrdNetTrendingSection(
  text: string,
  sourceRef: string
): OrdNetCollectionDirectoryEntry[] {
  const sectionText = sliceBetweenLabels(text, "Collection Trend", "Recently Verified")
  if (!sectionText) return []

  const entries: OrdNetCollectionDirectoryEntry[] = []
  const rows = sectionText
    .split(/(?=\s+\d{1,3}\s+)/)
    .map((row) => row.trim())
    .filter(Boolean)

  for (const row of rows) {
    const match = row.match(/^(\d{1,3})\s+(.+?)\s+—\s+([0-9.]+|—)\s+—\s+—\s+([\d,]+|—)/)
    if (!match) continue

    const name = normalizeRepeatedCollectionName(match[2])
    if (!looksLikeCollectionName(name)) continue

    entries.push({
      name,
      slug: slugifyCollectionName(name),
      section: "trending",
      rank: Number.parseInt(match[1], 10),
      volume_24h: match[3] !== "—" ? match[3] : undefined,
      supply: match[4] !== "—" ? match[4] : undefined,
      source_ref: sourceRef,
    })
  }

  return entries
}

function sliceBetweenLabels(text: string, startLabel: string, endLabel: string): string | null {
  const start = text.indexOf(startLabel)
  if (start === -1) return null

  const end = text.indexOf(endLabel, start + startLabel.length)
  return text.slice(start + startLabel.length, end === -1 ? undefined : end)
}

function normalizeRepeatedCollectionName(name: string): string {
  const trimmed = name.trim()
  const half = Math.floor(trimmed.length / 2)
  const left = trimmed.slice(0, half).trim()
  const right = trimmed.slice(half).trim()
  return left && left === right ? left : trimmed
}

function looksLikeCollectionName(value: string): boolean {
  if (value.length < 2 || value.length > 80) return false
  if (/^(Info|Mempool|Collection|Trend|Floor|Listed|Supply|Market Cap)$/i.test(value)) return false
  return /[A-Za-z0-9]/.test(value)
}

function slugifyCollectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeCollectionSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function toReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;|&sol;/g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseRegistryEntries(
  raw: unknown,
  qualityState: "verified" | "needs_info"
): RegistryEntry[] {
  if (!Array.isArray(raw)) return []

  const parsed: RegistryEntry[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue

    const candidate = entry as Record<string, unknown>
    const name = typeof candidate.name === "string" ? candidate.name : null
    const type = candidate.type === "gallery" || candidate.type === "parent" ? candidate.type : null
    const slug = typeof candidate.slug === "string" ? candidate.slug : null
    const issues = Array.isArray(candidate.issues)
      ? candidate.issues.filter((issue): issue is string => typeof issue === "string")
      : []

    if (!name || !type || !slug) continue

    if (type === "gallery" && typeof candidate.id === "string") {
      parsed.push({ name, type, id: candidate.id, slug, issues: qualityState === "needs_info" ? issues : [] })
      continue
    }

    if (type === "parent" && Array.isArray(candidate.ids)) {
      const ids = candidate.ids.filter((id): id is string => typeof id === "string")
      if (ids.length === 0) continue
      parsed.push({ name, type, ids, slug, issues: qualityState === "needs_info" ? issues : [] })
    }
  }

  return parsed
}

interface RegistryMatchArgs {
  inscriptionId: string
  parentIds: Set<string>
  galleryId?: string
  verifiedEntries: RegistryEntry[]
  needsInfoEntries: RegistryEntry[]
}

export function selectRegistryMatch({
  inscriptionId,
  parentIds,
  galleryId,
  verifiedEntries,
  needsInfoEntries,
}: RegistryMatchArgs): CuratedRegistryMatch | null {
  const qualitySets: Array<{
    qualityState: "verified" | "needs_info"
    entries: RegistryEntry[]
  }> = [
    { qualityState: "verified", entries: verifiedEntries },
    { qualityState: "needs_info", entries: needsInfoEntries },
  ]

  for (const { qualityState, entries } of qualitySets) {
    const exactParentMatch = entries.find(
      (entry) =>
        entry.type === "parent" &&
        [...parentIds].some((parentId) => entry.ids.includes(parentId))
    )
    if (exactParentMatch?.type === "parent") {
      return toRegistryMatch(exactParentMatch, qualityState, qualityState === "verified" ? VERIFIED_REGISTRY_URL : NEEDS_INFO_REGISTRY_URL)
    }

    const rootParentMatch = entries.find(
      (entry) => entry.type === "parent" && entry.ids.includes(inscriptionId)
    )
    if (rootParentMatch?.type === "parent") {
      return toRegistryMatch(rootParentMatch, qualityState, qualityState === "verified" ? VERIFIED_REGISTRY_URL : NEEDS_INFO_REGISTRY_URL)
    }

    if (galleryId) {
      const galleryMatch = entries.find(
        (entry) => entry.type === "gallery" && entry.id === galleryId
      )
      if (galleryMatch?.type === "gallery") {
        return toRegistryMatch(galleryMatch, qualityState, qualityState === "verified" ? VERIFIED_REGISTRY_URL : NEEDS_INFO_REGISTRY_URL)
      }
    }

    const directGalleryMatch = entries.find(
      (entry) => entry.type === "gallery" && entry.id === inscriptionId
    )
    if (directGalleryMatch?.type === "gallery") {
      return toRegistryMatch(directGalleryMatch, qualityState, qualityState === "verified" ? VERIFIED_REGISTRY_URL : NEEDS_INFO_REGISTRY_URL)
    }
  }

  return null
}

function toRegistryMatch(
  entry: RegistryEntry,
  qualityState: "verified" | "needs_info",
  sourceRef: string
): CuratedRegistryMatch {
  return {
    matched_collection: entry.name,
    match_type: entry.type,
    slug: entry.slug,
    registry_ids: entry.type === "gallery" ? [entry.id] : entry.ids,
    quality_state: qualityState,
    issues: entry.issues ?? [],
    source_ref: sourceRef,
  }
}

function toRelatedInscriptionSummary(item: RecursiveInscriptionSummary): RelatedInscriptionSummary {
  return {
    inscription_id: item.id,
    inscription_number: item.number,
    content_type: item.content_type,
    content_url: `${ORDINALS_BASE_URL}/content/${item.id}`,
    genesis_block: item.height,
    genesis_timestamp: item.timestamp
      ? new Date(item.timestamp * 1000).toISOString()
      : undefined,
  }
}

async function fetchOptionalJson<T>(
  url: string,
  optionsOrContext?:
    | RequestInit
    | {
        sourceCatalog: SourceCatalogItem[]
        sourceType: string
        urlOrRef: string
        trustLevel: SourceCatalogItem["trust_level"]
        fetchedAt: string
        detail?: string
      },
  maybeContext?: {
    sourceCatalog: SourceCatalogItem[]
    sourceType: string
    urlOrRef: string
    trustLevel: SourceCatalogItem["trust_level"]
    fetchedAt: string
    detail?: string
  }
): Promise<T | null> {
  const context = maybeContext ?? (isSourceContext(optionsOrContext) ? optionsOrContext : undefined)
  const requestInit = isSourceContext(optionsOrContext)
    ? undefined
    : optionsOrContext

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(requestInit?.headers ?? {}),
      },
      ...requestInit,
    })

    if (!res.ok) {
      pushSourceCatalog(context, true, `${res.status} ${res.statusText}`)
      return null
    }

    pushSourceCatalog(context, false)
    return (await res.json()) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error"
    pushSourceCatalog(context, true, message)
    return null
  }
}

async function fetchOptionalText(
  url: string,
  context: {
    sourceCatalog: SourceCatalogItem[]
    sourceType: string
    urlOrRef: string
    trustLevel: SourceCatalogItem["trust_level"]
    fetchedAt: string
    detail?: string
  }
): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      pushSourceCatalog(context, true, `${res.status} ${res.statusText}`)
      return null
    }

    pushSourceCatalog(context, false)
    return await res.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error"
    pushSourceCatalog(context, true, message)
    return null
  }
}

function pushSourceCatalog(
  context:
    | {
        sourceCatalog: SourceCatalogItem[]
        sourceType: string
        urlOrRef: string
        trustLevel: SourceCatalogItem["trust_level"]
        fetchedAt: string
        detail?: string
      }
    | undefined,
  partial: boolean,
  detailSuffix?: string
) {
  if (!context) return

  context.sourceCatalog.push({
    source_type: context.sourceType,
    url_or_ref: context.urlOrRef,
    trust_level: context.trustLevel,
    fetched_at: context.fetchedAt,
    partial,
    detail: detailSuffix
      ? `${context.detail ?? context.sourceType} · ${detailSuffix}`
      : context.detail,
  })
}

function isSourceContext(
  value: RequestInit | {
    sourceCatalog: SourceCatalogItem[]
    sourceType: string
    urlOrRef: string
    trustLevel: SourceCatalogItem["trust_level"]
    fetchedAt: string
    detail?: string
  } | undefined
): value is {
  sourceCatalog: SourceCatalogItem[]
  sourceType: string
  urlOrRef: string
  trustLevel: SourceCatalogItem["trust_level"]
  fetchedAt: string
  detail?: string
} {
  return Boolean(value && "sourceCatalog" in value)
}

function summarizeCount(count: number, more: boolean, noun: string): string {
  const suffix = count === 1 ? noun : `${noun}s`
  return more ? `${count}+ ${suffix}` : `${count} ${suffix}`
}

function shortenInscriptionId(inscriptionId: string): string {
  return `${inscriptionId.slice(0, 12)}…`
}
