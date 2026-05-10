// Ord.net API v1 — Wallet authentication flow.
// The challenge/verify exchange happens entirely in the browser.
// Session tokens are stored in sessionStorage (ephemeral, per-tab).

import type {
  OrdNetAuthChallengeResponse,
  OrdNetAuthVerifyResponse,
  OrdNetVerificationItem,
  OrdNetSession,
} from "./types"

const BASE_URL = "https://ord.net/api/v1"
const SESSION_KEY = "ordinalMind_ordNetSession"

// ─── Token storage (sessionStorage — per-tab, ephemeral) ─────────────────────

export function getSession(): OrdNetSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null

    const session = JSON.parse(raw) as OrdNetSession
    if (!session.sessionToken || !session.expiresAt) return null

    // Check expiry
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession()
      return null
    }

    return session
  } catch {
    return null
  }
}

export function storeSession(session: OrdNetSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function isSessionActive(): boolean {
  return getSession() !== null
}

/**
 * Returns minutes until session expiry, or 0 if expired/no session.
 */
export function sessionTTLMinutes(): number {
  const session = getSession()
  if (!session) return 0
  const remaining = new Date(session.expiresAt).getTime() - Date.now()
  return Math.max(0, Math.floor(remaining / 60_000))
}

// ─── Challenge / Verify flow ─────────────────────────────────────────────────

/**
 * Step 1: Request a challenge from ord.net.
 * Returns challenge messages that the wallet must sign.
 */
export async function requestChallenge(
  ordinalsAddress: string,
  paymentAddress: string
): Promise<OrdNetAuthChallengeResponse> {
  const res = await fetch(`${BASE_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordinalsAddress, paymentAddress }),
  })

  if (!res.ok) {
    const body = await safeJson(res)
    throw new OrdNetAuthError(
      res.status,
      body?.error ?? `Challenge request failed (${res.status})`
    )
  }

  return (await res.json()) as OrdNetAuthChallengeResponse
}

/**
 * Step 2: Submit signed challenges to get a session token.
 * The wallet must sign each challenge.message with BIP-322.
 */
export async function submitVerification(
  authRequestId: string,
  verifications: OrdNetVerificationItem[]
): Promise<OrdNetAuthVerifyResponse> {
  const res = await fetch(`${BASE_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authRequestId, verifications }),
  })

  if (!res.ok) {
    const body = await safeJson(res)
    throw new OrdNetAuthError(
      res.status,
      body?.error ?? `Verification failed (${res.status})`
    )
  }

  return (await res.json()) as OrdNetAuthVerifyResponse
}

/**
 * Complete auth flow: challenge → sign → verify → store session.
 * The signMessages callback is called with the challenge items
 * and must return the signed messages (hex signatures).
 */
export async function authenticateWithWallet(
  ordinalsAddress: string,
  paymentAddress: string,
  signMessages: (
    challenges: OrdNetAuthChallengeResponse["challenges"]
  ) => Promise<OrdNetVerificationItem[]>
): Promise<OrdNetSession> {
  // Step 1: Get challenge
  const challenge = await requestChallenge(ordinalsAddress, paymentAddress)

  // Step 2: Have the wallet sign each challenge
  const verifications = await signMessages(challenge.challenges)

  // Step 3: Submit verifications
  const result = await submitVerification(challenge.authRequestId, verifications)

  // Step 4: Store session
  const session: OrdNetSession = {
    sessionToken: result.sessionToken,
    expiresAt: result.expiresAt,
    walletBindingId: result.walletBindings[0]?.walletBindingId ?? "",
    ordinalsAddress,
    paymentAddress,
  }

  storeSession(session)
  return session
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class OrdNetAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "OrdNetAuthError"
  }

  /** Payment address does not meet 0.01 BTC requirement */
  get isFundingError(): boolean {
    return this.status === 403
  }

  /** Challenge expired — start a new flow */
  get isExpired(): boolean {
    return this.status === 410
  }

  /** Rate limited */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /** Temporary unavailability (e.g., funding check down) */
  get isTemporary(): boolean {
    return this.status === 503
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string }
  } catch {
    return null
  }
}
