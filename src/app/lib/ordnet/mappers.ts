// Ord.net API v1 — Mappers from API responses to OrdinalMind internal types.
// These pure functions transform structured API data into the same shapes
// the existing HTML scraping produces, so the rest of the pipeline is unaffected.

import type {
  OrdNetCollectionInscription,
  OrdNetListing,
  OrdNetSale,
  OrdNetApiEnrichedData,
} from "./types"
import type {
  MarketOverlayMatch,
  MarketRarityOverlay,
  CollectionMarketStats,
  ChronicleEvent,
} from "../types"

// ─── Market overlay from collection inscription ──────────────────────────────

/**
 * Maps an ord.net API collection inscription item into the same MarketOverlayMatch
 * shape that the HTML scraper produces.
 */
export function mapCollectionInscriptionToOverlay(
  item: OrdNetCollectionInscription
): MarketOverlayMatch {
  const rarity = mapTraitsToRarityOverlay(item.traits, item.collection)

  return {
    collection_slug: item.collection,
    collection_name: resolveCollectionDisplayName(item),
    collection_href: item.collectionHref,
    item_name: item.name || undefined,
    verified: true, // API access implies verified collection
    owner_address: item.owner,
    source_ref: `https://ord.net/api/v1/collection/${item.collection}/inscriptions`,
    rarity_overlay: rarity,
  }
}

function resolveCollectionDisplayName(item: OrdNetCollectionInscription): string {
  // The API returns the slug in `collection`, but the display name can
  // often be inferred from the slug by capitalizing segments.
  // The collection name often matches the slug with hyphens/underscores replaced.
  const slug = item.collection
  return slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

// ─── Rarity overlay from traits ──────────────────────────────────────────────

function mapTraitsToRarityOverlay(
  traits: OrdNetCollectionInscription["traits"],
  collectionSlug: string
): MarketRarityOverlay | undefined {
  if (!traits || traits.length === 0) return undefined

  const mapped = traits.map(trait => ({
    key: trait.type,
    value: trait.value,
    tokenCount: trait.count,
    percentage: trait.percentage,
  }))

  return {
    source: "ord_net",
    rank: 0, // API doesn't provide a global rank directly
    supply: undefined,
    source_ref: `https://ord.net/api/v1/collection/${collectionSlug}/inscriptions`,
    traits: mapped,
  }
}

// ─── Listing to market info ──────────────────────────────────────────────────

/**
 * Extract listing-related context that enriches the inscription overlay.
 */
export function mapListingToOverlayEnrichment(
  listing: OrdNetListing,
  existingOverlay: MarketOverlayMatch | null
): MarketOverlayMatch {
  const base = existingOverlay ?? {
    collection_slug: listing.collection.slug,
    collection_name: listing.collection.name,
    collection_href: `/collection/${listing.collection.slug}`,
    item_name: listing.inscriptionName,
    verified: listing.collection.verificationStatus === "verified",
    source_ref: "https://ord.net/api/v1/listings",
  }

  return {
    ...base,
    collection_slug: listing.collection.slug,
    collection_name: listing.collection.name,
    verified: listing.collection.verificationStatus === "verified",
  }
}

// ─── Sales to Chronicle events ───────────────────────────────────────────────

/**
 * Maps ord.net sales into Chronicle events (event_type: "sale").
 */
export function mapSalesToEvents(sales: OrdNetSale[]): ChronicleEvent[] {
  return sales.map((sale) => ({
    id: `sale-ordnet-${sale.saleId}`,
    timestamp: sale.soldAt,
    block_height: sale.blockHeight,
    event_type: "sale" as const,
    source: {
      type: "onchain" as const,
      ref: sale.txid,
    },
    description: formatSaleDescription(sale),
    metadata: {
      sale_type: sale.saleType,
      price_sats: sale.priceSats,
      price_btc: sale.price,
      price_usd: sale.priceUsd,
      seller_address: sale.sellerAddress,
      buyer_address: sale.buyerAddress,
      collection_slug: sale.collection.slug,
      collection_name: sale.collection.name,
      source: "ord_net_api",
    },
  }))
}

function formatSaleDescription(sale: OrdNetSale): string {
  const priceFormatted = sale.price >= 1
    ? `${sale.price.toFixed(2)} BTC`
    : `${sale.priceSats.toLocaleString()} sats`

  const typeLabel = sale.saleType === "internal" ? "on ord.net" : "external"

  return `Sold ${typeLabel} for ${priceFormatted} (${sale.sellerAddress.slice(0, 8)}… → ${sale.buyerAddress.slice(0, 8)}…)`
}

// ─── Collection market stats from listing/sale aggregation ───────────────────

/**
 * Build partial market stats from listings data.
 */
export function mapListingsToMarketStats(
  listings: OrdNetListing[],
  collectionSlug: string
): CollectionMarketStats | null {
  if (listings.length === 0) return null

  const prices = listings
    .map(l => l.priceSats)
    .filter((p): p is number => p != null && p > 0)
    .sort((a, b) => a - b)

  const floorSats = prices[0]
  const floorBtc = floorSats != null ? (floorSats / 100_000_000).toFixed(8) : undefined

  return {
    source_ref: `https://ord.net/api/v1/listings?collectionSlug=${collectionSlug}`,
    floor_price: floorBtc ? `${floorBtc} BTC` : undefined,
    listed: String(listings.length),
  }
}

// ─── Enriched data builder ───────────────────────────────────────────────────

/**
 * Build the enriched data payload that the client passes to the worker
 * (via the API response or header).
 */
export function buildEnrichedData(params: {
  inscription?: OrdNetCollectionInscription | null
  listings?: OrdNetListing[]
  sales?: OrdNetSale[]
}): OrdNetApiEnrichedData {
  return {
    inscription: params.inscription ?? null,
    listings: params.listings ?? [],
    sales: params.sales ?? [],
    source: "ord_net_api",
    fetchedAt: new Date().toISOString(),
  }
}
