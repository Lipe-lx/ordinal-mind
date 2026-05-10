// Ord.net API v1 — TypeScript types for all API responses.
// Reference: https://developers.ord.net/

// ─── Authentication ──────────────────────────────────────────────────────────

export interface OrdNetAuthChallengeRequest {
  ordinalsAddress: string
  paymentAddress: string
}

export interface OrdNetAuthChallengeItem {
  challengeId: string
  message: string
  address: string
  role: "ordinals" | "payment"
}

export interface OrdNetAuthChallengeResponse {
  authRequestId: string
  challenges: OrdNetAuthChallengeItem[]
}

export interface OrdNetVerificationItem {
  challengeId: string
  signature: string
  address: string
}

export interface OrdNetAuthVerifyRequest {
  authRequestId: string
  verifications: OrdNetVerificationItem[]
}

export interface OrdNetWalletBinding {
  walletBindingId: string
  label: string
  provider: string
  ordinalsAddress: string
  paymentAddress: string
  isPublic: boolean
}

export interface OrdNetProfile {
  id: string
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
}

export interface OrdNetAuthVerifyResponse {
  profile: OrdNetProfile
  walletBindings: OrdNetWalletBinding[]
  sessionToken: string
  expiresAt: string
}

export interface OrdNetMeResponse {
  profile: OrdNetProfile
  walletBindings: OrdNetWalletBinding[]
}

// ─── Session (client-side stored state) ──────────────────────────────────────

export interface OrdNetSession {
  sessionToken: string
  expiresAt: string
  walletBindingId: string
  ordinalsAddress: string
  paymentAddress: string
}

// ─── Collections ─────────────────────────────────────────────────────────────

export interface OrdNetCollectionTrait {
  type: string
  value: string
  count: number
  percentage: number
}

export interface OrdNetCollectionInscription {
  id: string
  name: string
  collection: string
  collectionHref: string
  collections: string[]
  image: string
  inscription: number
  inscriptionId: string
  listingId: string | null
  listingState: "buyable" | "hidden_locked" | "pending_public" | null
  priceSats: number | null
  price: number | null
  listedAt: string | null
  listingExpiresAt: string | null
  lastSale: unknown | null
  owner: string
  contentType: "image" | "html" | "video" | "text"
  rawContentType: string
  imageRenderingHint: "auto" | "pixelated"
  cardBackgroundColor: string | null
  traits: OrdNetCollectionTrait[]
  satributes: string[]
  sat: number
  locationTxid: string
  locationVout: number
  locationSatpoint: string
}

export interface OrdNetPagination {
  pageSize: number
  hasNext: boolean
  nextCursor: string | null
}

export interface OrdNetCollectionResponse {
  items: OrdNetCollectionInscription[]
  pagination: OrdNetPagination
}

// ─── Listings ────────────────────────────────────────────────────────────────

export interface OrdNetListingCollectionInfo {
  slug: string
  name: string
  kind: "parent_child" | "gallery"
  verificationStatus: "verified" | "unverified"
}

export interface OrdNetListing {
  listingId: string
  inscriptionId: string
  inscriptionNumber: string
  inscriptionName: string
  collection: OrdNetListingCollectionInfo
  sellerAddress: string
  priceSats: number
  listedAt: string
  listingExpiresAt: string
  sat: number
  locationTxid: string
  locationVout: number
  locationSatpoint: string
}

export interface OrdNetListingsResponse {
  listings: OrdNetListing[]
  pagination: OrdNetPagination
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface OrdNetSaleCollectionInfo {
  slug: string
  name: string
  kind: "parent_child" | "gallery"
  verificationStatus: "verified" | "unverified"
}

export interface OrdNetSale {
  saleId: string
  saleType: "internal" | "external"
  txid: string
  inscriptionId: string
  inscriptionNumber: string
  inscriptionName: string
  collection: OrdNetSaleCollectionInfo
  sellerAddress: string
  buyerAddress: string
  priceSats: number
  price: number
  priceUsd: number
  soldAt: string
  blockHeight: number
}

export interface OrdNetSalesResponse {
  sales: OrdNetSale[]
  pagination: OrdNetPagination
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface OrdNetErrorResponse {
  error: string
}

// ─── API-enriched data passed to worker ──────────────────────────────────────

export interface OrdNetApiEnrichedData {
  /** Pre-fetched inscription context from the collection endpoint */
  inscription?: OrdNetCollectionInscription | null
  /** Pre-fetched listings for the inscription */
  listings?: OrdNetListing[]
  /** Pre-fetched sales for the collection */
  sales?: OrdNetSale[]
  /** Source of this data */
  source: "ord_net_api"
  /** Timestamp of the fetch */
  fetchedAt: string
}
