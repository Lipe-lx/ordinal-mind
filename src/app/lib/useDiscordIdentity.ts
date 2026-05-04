// useDiscordIdentity — React hook for Discord OAuth identity.
// Handles: JWT capture from OAuth callback, localStorage persistence, /api/auth/me validation.
//
// Storage:
//   - JWT stored in localStorage (persists across sessions)
//   - On connect: KeyStore.promoteToLocalStorage() encrypts LLM keys in localStorage
//   - On disconnect: KeyStore.demoteToSessionStorage() moves keys back to sessionStorage

import { useState, useEffect, useCallback } from "react"
import { useLocation } from "react-router"
import { decodeJWTPayload } from "./byok/jwtClient"
import type { OGTier } from "./byok/jwtClient"

export interface DiscordIdentity {
  discordId: string
  username: string
  avatar: string | null
  tier: OGTier
}

const JWT_STORAGE_KEY = "ordinal-mind_discord_jwt"
const AUTH_TOKEN_PARAM = "auth_token"
const AUTH_ERROR_PARAM = "auth_error"
const AUTH_SYNC_EVENT = "ordinal-mind:auth-sync"

function broadcastAuthSync(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(AUTH_SYNC_EVENT))
}

function readStoredJWT(): string | null {
  try {
    return localStorage.getItem(JWT_STORAGE_KEY)
  } catch {
    return null
  }
}

function storeJWT(token: string): void {
  try {
    localStorage.setItem(JWT_STORAGE_KEY, token)
  } catch { /* noop */ }
  broadcastAuthSync()
}

function clearJWT(): void {
  try {
    localStorage.removeItem(JWT_STORAGE_KEY)
  } catch { /* noop */ }
  broadcastAuthSync()
}

function isJWTExpired(token: string): boolean {
  const payload = decodeJWTPayload(token)
  if (!payload) return true
  const now = Math.floor(Date.now() / 1000)
  return payload.exp < now
}

function payloadToIdentity(payload: ReturnType<typeof decodeJWTPayload>): DiscordIdentity | null {
  if (!payload) return null
  return {
    discordId: payload.sub,
    username: payload.username,
    avatar: payload.avatar,
    tier: payload.tier,
  }
}

/**
 * Capture and clean auth_token / auth_error from URL (OAuth callback redirect).
 * Returns the captured token string or null.
 */
function captureAndCleanURLParams(): { token: string | null; error: string | null } {
  try {
    const url = new URL(window.location.href)
    const token = url.searchParams.get(AUTH_TOKEN_PARAM)
    const error = url.searchParams.get(AUTH_ERROR_PARAM)

    if (token || error) {
      url.searchParams.delete(AUTH_TOKEN_PARAM)
      url.searchParams.delete(AUTH_ERROR_PARAM)
      window.history.replaceState({}, "", url.toString())
    }

    return { token, error }
  } catch {
    return { token: null, error: null }
  }
}

/**
 * Validate JWT against /api/auth/me and return fresh identity.
 * Returns null if validation fails.
 */
async function validateWithServer(token: string): Promise<DiscordIdentity | null> {
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ok: boolean; user?: DiscordIdentity }
    if (!data.ok || !data.user) return null
    return data.user
  } catch {
    return null
  }
}

export function useDiscordIdentity() {
  const location = useLocation()
  const [identity, setIdentity] = useState<DiscordIdentity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [syncTick, setSyncTick] = useState(0)

  useEffect(() => {
    function handleAuthSync() {
      setSyncTick((value) => value + 1)
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === JWT_STORAGE_KEY) {
        handleAuthSync()
      }
    }

    window.addEventListener(AUTH_SYNC_EVENT, handleAuthSync)
    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener(AUTH_SYNC_EVENT, handleAuthSync)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      setIsLoading(true)

      // 1. Check for OAuth callback redirect params in URL
      const { token: urlToken, error: urlError } = captureAndCleanURLParams()

      if (urlError) {
        setAuthError(urlError)
        setIdentity(null)
        setIsLoading(false)
        return
      }

      setAuthError(null)

      let token: string | null = urlToken

      if (token) {
        // Fresh from OAuth callback — store and promote LLM keys
        storeJWT(token)
        try {
          // Dynamically import to avoid circular deps (KeyStore uses byok/index)
          const { KeyStore } = await import("./byok/index")
          await KeyStore.promoteToLocalStorage()
        } catch {
          // Non-blocking: LLM keys stay in sessionStorage if promotion fails
        }
      } else {
        // 2. Check existing localStorage JWT
        token = readStoredJWT()
      }

      if (!token) {
        if (!cancelled) setIdentity(null)
        if (!cancelled) setIsLoading(false)
        return
      }

      // 3. Client-side expiry check (fast path — avoids network if clearly expired)
      if (isJWTExpired(token)) {
        clearJWT()
        if (!cancelled) setIdentity(null)
        if (!cancelled) setIsLoading(false)
        return
      }

      // 4. Optimistic: set identity from JWT payload immediately (no flicker)
      const optimisticPayload = decodeJWTPayload(token)
      if (!cancelled) setIdentity(payloadToIdentity(optimisticPayload))

      // 5. Validate with server for fresh data
      const validated = await validateWithServer(token)
      if (cancelled) return

      if (!validated) {
        // Server rejected — token invalid or expired server-side
        clearJWT()
        setIdentity(null)
      } else {
        setIdentity(validated)
      }

      setIsLoading(false)
    }

    void init()
    return () => { cancelled = true }
  }, [location.search, syncTick])

  /**
   * Redirect to Discord OAuth flow.
   */
  const connect = useCallback(async () => {
    setAuthError(null)
    window.location.href = "/api/auth/discord"
  }, [])

  /**
   * Disconnect: clear JWT, demote LLM keys back to sessionStorage.
   */
  const disconnect = useCallback(async () => {
    clearJWT()
    setIdentity(null)
    setAuthError(null)

    // Move LLM keys back to ephemeral sessionStorage
    try {
      const { KeyStore } = await import("./byok/index")
      await KeyStore.demoteToSessionStorage()
    } catch {
      // Non-blocking: worst case user needs to re-enter LLM key
    }

    // Optional: notify server for analytics (fire-and-forget)
    void fetch("/api/auth/disconnect", { method: "POST" }).catch(() => {})
  }, [])

  return {
    identity,
    isLoading,
    authError,
    connect,
    disconnect,
    isConnected: identity !== null,
  }
}
