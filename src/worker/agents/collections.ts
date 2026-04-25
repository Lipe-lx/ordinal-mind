import type {
  CollectionContext,
  CollectionPresentationFacet,
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

const ORDINALS_BASE_URL = "https://ordinals.com"
const VERIFIED_REGISTRY_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections.json"
const NEEDS_INFO_REGISTRY_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/collections-needs-info.json"
const LEGACY_COLLECTIONS_BASE_URL =
  "https://raw.githubusercontent.com/TheWizardsOfOrd/ordinals-collections/main/legacy/collections"
const ORD_MARKET_BASE_URL = "https://ord.net"

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
  const marketOverlay = await fetchMarketOverlay(inscriptionId, fetchedAt, sourceCatalog)
  const registry = await fetchRegistryOverlay(
    inscriptionId,
    selfDetails,
    parents,
    protocolGallery,
    marketOverlay,
    fetchedAt,
    sourceCatalog
  )

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
    presentation: buildPresentation(
      selfDetails,
      parents,
      children,
      protocolGallery,
      registry.match,
      marketOverlay
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
  marketMatch: MarketOverlayMatch | null
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
