// Ord.net API v1 — Public barrel export.
// Client-side module for authenticated access to the ord.net trading API.
// All requests go directly from the browser to ord.net (CORS enabled).
// No wallet keys or session tokens pass through the OrdinalMind server.

export type {
  OrdNetSession,
  OrdNetAuthChallengeResponse,
  OrdNetAuthVerifyResponse,
  OrdNetCollectionInscription,
  OrdNetCollectionResponse,
  OrdNetListing,
  OrdNetListingsResponse,
  OrdNetSale,
  OrdNetSalesResponse,
  OrdNetApiEnrichedData,
  OrdNetVerificationItem,
  OrdNetWalletBinding,
  OrdNetProfile,
} from "./types"

export {
  getSession,
  storeSession,
  clearSession,
  isSessionActive,
  sessionTTLMinutes,
  requestChallenge,
  submitVerification,
  authenticateWithWallet,
  OrdNetAuthError,
} from "./auth"

export {
  fetchCollectionInscriptions,
  findInscriptionInCollection,
  fetchListings,
  fetchSales,
  fetchMe,
  hasActiveSession,
  OrdNetApiError,
} from "./client"

export {
  mapCollectionInscriptionToOverlay,
  mapListingToOverlayEnrichment,
  mapSalesToEvents,
  mapListingsToMarketStats,
  buildEnrichedData,
} from "./mappers"
