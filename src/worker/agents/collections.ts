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
}

export async function fetchCollectionContext(
  inscriptionId: string,
  meta: InscriptionMeta
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

  const protocolGallery = await fetchProtocolGallery(inscriptionId, selfDetails, fetchedAt, sourceCatalog)
  const ordNetOverlay = await fetchMarketOverlay(inscriptionId, fetchedAt, sourceCatalog)
  // Fallback: when ord.net doesn't classify the inscription, try Satflow's individual page
  const marketOverlay = ordNetOverlay
    ?? await fetchSatflowInscriptionOverlay(inscriptionId, fetchedAt, sourceCatalog)
  const ordNetDirectoryMatch = marketOverlay
    ? await fetchOrdNetCollectionDirectoryMatch(marketOverlay, fetchedAt, sourceCatalog)
    : null
  const satflowStats = marketOverlay?.collection_slug
    ? await fetchSatflowCollectionStats(marketOverlay.collection_slug, fetchedAt, sourceCatalog)
    : null
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

  const collectionContext: CollectionContext = {
    protocol: {
      parents,
      children,
      gallery: protocolGallery,
    },
    registry,
    market: {
      match: marketOverlay,
    },
    profile,
    presentation: buildPresentation(
      selfDetails,
      parents,
      children,
      protocolGallery,
      registry.match,
      marketOverlay,
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
  }
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
  satflowStats: CollectionMarketStats | null,
  ordNetDirectoryMatch: OrdNetCollectionDirectoryEntry | null
): CollectionContext["presentation"] {
  const facets: CollectionPresentationFacet[] = []

  if (marketMatch) {
    facets.push({
      label: marketMatch.verified ? "Verified Collection" : "Market Overlay",
      value: marketMatch.collection_name,
      tone: marketMatch.verified ? "overlay" : "partial",
      detail: marketMatch.item_name
        ? `${marketMatch.item_name} · ${marketMatch.collection_slug}`
        : marketMatch.collection_slug,
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

  return {
    primary_label:
      registryMatch?.matched_collection ??
      marketMatch?.collection_name ??
      selfDetails?.properties?.attributes?.title,
    facets: mergedFacets,
  }
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

async function fetchSatflowCollectionStats(
  slug: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
): Promise<CollectionMarketStats | null> {
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

  if (!html) return null
  return parseSatflowCollectionStats(html, url)
}

async function fetchMarketOverlay(
  inscriptionId: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
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

  if (!html) return null
  return parseOrdMarketOverlay(html, url)
}

async function fetchSatflowInscriptionOverlay(
  inscriptionId: string,
  fetchedAt: string,
  sourceCatalog: SourceCatalogItem[]
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

  if (!html) return null
  return parseSatflowInscriptionOverlay(html, url)
}

export function parseSatflowInscriptionOverlay(
  html: string,
  sourceRef: string
): MarketOverlayMatch | null {
  // Pattern 1: OG title — "{ItemName} - {CollectionName}" (when collection exists)
  // When no collection: "Ordinal {id}" — skip this
  const ogTitle = html.match(
    /og:title["']?\s*content=["']([^"']+)["']/
  )?.[1]

  // If the OG title starts with "Ordinal " it means Satflow doesn't know the collection
  if (!ogTitle || ogTitle.startsWith("Ordinal ")) return null

  // Pattern 2: collection href — href="/ordinals/{slug}"
  const collectionHrefMatch = html.match(
    /href=["']\/ordinals\/([^"']+)["']/
  )
  const collectionSlug = collectionHrefMatch?.[1]
  if (!collectionSlug) return null

  // Parse the title: "{ItemName} - {CollectionName}"
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

  return {
    collection_slug: collectionSlug,
    collection_name: collectionName,
    collection_href: `/ordinals/${collectionSlug}`,
    item_name: itemName,
    verified: false,
    source_ref: sourceRef,
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
  const collectionSlug = html.match(/collection:"([^"]+)"/)?.[1]
    ?? html.match(/verifiedCollections:\[\{[\s\S]*?slug:"([^"]+)"/)?.[1]
  const collectionHref = html.match(/collectionHref:"([^"]+)"/)?.[1]
    ?? html.match(/verifiedCollections:\[\{[\s\S]*?href:"([^"]+)"/)?.[1]
  const collectionName = html.match(/collection:\{[\s\S]*?name:"([^"]+)"/)?.[1]
    ?? html.match(/verifiedCollections:\[\{[\s\S]*?name:"([^"]+)"/)?.[1]
  const itemName = html.match(/item:\{[\s\S]*?name:"([^"]+)"/)?.[1]
    ?? html.match(/<title>([^<]+)<\/title>/)?.[1]
  const ownerAddress = html.match(/item:\{[\s\S]*?owner:"([^"]+)"/)?.[1]
  const verifiedMatch = html.match(/collection:\{[\s\S]*?verified:(true|false)/)?.[1]
    ?? (html.includes("verifiedCollections:[{") ? "true" : undefined)

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
  }
}

export function parseSatflowCollectionStats(
  html: string,
  sourceRef: string
): CollectionMarketStats | null {
  const floorMatch = html.match(/\\?"floorPrice\\?":([0-9.]+)/i)
  const change7dMatch = html.match(/\\?"priceChangePercent7d\\?":(-?[0-9.]+)/i)
  const volume7dMatch = html.match(/\\?"volume7D\\?":([0-9.]+)/i)
  const supplyMatch = html.match(/\\?"totalSupply\\?":(\d+)/i)
  const marketCapMatch = html.match(/\\?"marketCap\\?":\\?"?([0-9.]+)\\?"?/i)

  const formatBtc = (val: string | undefined) => {
    if (!val) return undefined
    const num = Number.parseFloat(val)
    if (Number.isNaN(num)) return undefined
    if (num < 0.0001) return num.toPrecision(2)
    return Number.parseFloat(num.toFixed(4)).toString()
  }

  const formatCount = (val: string | undefined) => {
    if (!val) return undefined
    const num = Number.parseInt(val, 10)
    if (Number.isNaN(num)) return undefined
    if (num >= 1_000_000) return Number.parseFloat((num / 1_000_000).toFixed(1)).toString() + "M"
    if (num >= 1_000) return Number.parseFloat((num / 1_000).toFixed(1)).toString() + "k"
    return num.toString()
  }

  const formatPercent = (val: string | undefined) => {
    if (!val) return undefined
    const num = Number.parseFloat(val)
    if (Number.isNaN(num)) return undefined
    return (num > 0 ? "+" : "") + num.toFixed(2) + "%"
  }

  const stats: CollectionMarketStats = {
    source_ref: sourceRef,
    floor_price: formatBtc(floorMatch?.[1]),
    change_7d: formatPercent(change7dMatch?.[1]),
    volume_7d: formatBtc(volume7dMatch?.[1]),
    supply: formatCount(supplyMatch?.[1]),
    listed: undefined, // Listed count not exposed directly in payload
    market_cap: formatBtc(marketCapMatch?.[1]),
  }

  const hasAnyValue = Object.entries(stats).some(
    ([key, value]) => key !== "source_ref" && typeof value === "string" && value.length > 0
  )

  return hasAnyValue ? stats : null
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
