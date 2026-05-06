// useDiscordIdentity — React hook for Discord OAuth identity.
// New flow:
//   callback -> #auth_code=<one_time_code> -> POST /api/auth/exchange -> HttpOnly cookie
//   then /api/auth/me validates cookie and returns profile.
//
// Legacy compatibility:
//   - Keeps readStoredDiscordJWT export for transitional code paths.

import { useState, useEffect, useCallback, useRef } from "react"
import { useLocation } from "react-router"

export interface DiscordIdentity {
  discordId: string
  username: string
  avatar: string | null
  tier: "anon" | "community" | "og" | "genesis"
  badges?: Array<{ name: string; level: number }>
}

export const DISCORD_JWT_STORAGE_KEY = "ordinal-mind_discord_jwt"
export const DISCORD_CONNECTED_STORAGE_KEY = "ordinal-mind_discord_connected"
const AUTH_CODE_PARAM = "auth_code"
const AUTH_ERROR_PARAM = "auth_error"
const AUTH_SYNC_EVENT = "ordinal-mind:auth-sync"

function broadcastAuthSync(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(AUTH_SYNC_EVENT))
}

export function readStoredDiscordJWT(): string | null {
  try {
    return localStorage.getItem(DISCORD_JWT_STORAGE_KEY)
  } catch {
    return null
  }
}

function clearLegacyJWT(): void {
  try {
    localStorage.removeItem(DISCORD_JWT_STORAGE_KEY)
  } catch {
    // noop
  }
}

function setConnectedMarker(discordId: string | null): void {
  try {
    const key = DISCORD_CONNECTED_STORAGE_KEY
    const newVal = discordId || "0"
    const oldVal = localStorage.getItem(key)
    
    if (oldVal === newVal) return
    
    localStorage.setItem(key, newVal)
    broadcastAuthSync()
  } catch {
    // noop
  }
}

function captureAndCleanAuthParams(): { code: string | null; error: string | null } {
  try {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)

    const code = hashParams.get(AUTH_CODE_PARAM) ?? url.searchParams.get(AUTH_CODE_PARAM)
    const error = hashParams.get(AUTH_ERROR_PARAM) ?? url.searchParams.get(AUTH_ERROR_PARAM)

    if (code || error) {
      hashParams.delete(AUTH_CODE_PARAM)
      hashParams.delete(AUTH_ERROR_PARAM)
      url.searchParams.delete(AUTH_CODE_PARAM)
      url.searchParams.delete(AUTH_ERROR_PARAM)

      const nextHash = hashParams.toString()
      url.hash = nextHash ? `#${nextHash}` : ""
      window.history.replaceState({}, "", url.toString())
    }

    return { code, error }
  } catch {
    return { code: null, error: null }
  }
}

async function exchangeAuthCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: "same-origin",
    })
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || payload.ok !== true) {
      return { ok: false, error: typeof payload.error === "string" ? payload.error : "auth_exchange_failed" }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "auth_exchange_failed" }
  }
}

async function validateWithServer(): Promise<DiscordIdentity | null> {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "same-origin",
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

  const handlingCodeRef = useRef(false)

  useEffect(() => {
    function handleAuthSync() {
      setSyncTick((value) => value + 1)
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === DISCORD_CONNECTED_STORAGE_KEY) {
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
      if (handlingCodeRef.current) return
      
      if (!identity) {
        setIsLoading(true)
      }
      const { code, error } = captureAndCleanAuthParams()

      if (error) {
        if (!cancelled) {
          setAuthError(error)
          setIdentity(null)
          setConnectedMarker(null)
          setIsLoading(false)
        }
        return
      }

      if (code) {
        handlingCodeRef.current = true
        const exchanged = await exchangeAuthCode(code)
        handlingCodeRef.current = false
        
        if (!exchanged.ok) {
          if (!cancelled) {
            setAuthError(exchanged.error)
            setIdentity(null)
            setConnectedMarker(null)
            setIsLoading(false)
          }
          return
        }
      }

      const validated = await validateWithServer()
      // We don't return on cancelled here because if we just exchanged a code,
      // we MUST update the state even if the URL cleanup triggered a re-render.
      
      const identityChanged = (validated?.discordId !== identity?.discordId)

      if (!validated) {
        if (identity !== null) {
          setIdentity(null)
          setConnectedMarker(null)
        }
      } else {
        if (identityChanged) {
          setIdentity(validated)
          setConnectedMarker(validated.discordId)
        }
        
        setAuthError(null)
        try {
          const { KeyStore } = await import("./byok/index")
          await KeyStore.promoteToLocalStorage()
        } catch {
          // Non-blocking; keep factual app fully available.
        }
      }

      clearLegacyJWT()
      setIsLoading(false)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [location.search, location.hash, syncTick, identity])

  const connect = useCallback(() => {
    setAuthError(null)
    window.location.href = "/api/auth/discord"
  }, [])

  const disconnect = useCallback(async () => {
    setAuthError(null)
    setIdentity(null)
    setConnectedMarker(null)
    clearLegacyJWT()

    try {
      await fetch("/api/auth/disconnect", {
        method: "POST",
        credentials: "same-origin",
      })
    } catch {
      // best effort
    }

    try {
      const { KeyStore } = await import("./byok/index")
      await KeyStore.demoteToSessionStorage()
    } catch {
      // Non-blocking
    }
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
