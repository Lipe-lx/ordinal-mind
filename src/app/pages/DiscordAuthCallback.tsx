import { useEffect, useState, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router"

/**
 * DiscordAuthCallback handles the landing from Discord OAuth2.
 * It extracts the 'code' and 'state', calls the worker to exchange them for a JWT,
 * and then redirects home with the token.
 * 
 * This component acts as a bridge to ensure the OAuth flow works correctly
 * in dev environments where Vite might otherwise intercept the /api route.
 */
export function DiscordAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState("Connecting to Discord...")
  const exchangeStarted = useRef(false)

  // Derive static error state from URL parameters during render
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")

  const [error, setError] = useState<string | null>(() => {
    if (!oauthError && (!code || !state)) return "Missing authorization code or state."
    return null
  })

  useEffect(() => {
    let cancelled = false

    // 1. Handle OAuth error redirect (side effect)
    if (oauthError) {
      window.location.replace(`/?auth_error=${encodeURIComponent(oauthError)}`)
      return
    }

    // 2. If we already have a static error or missing params, don't proceed
    if (error || !code || !state) return

    // 3. Prevent double-execution in dev (React.StrictMode)
    if (exchangeStarted.current) return
    exchangeStarted.current = true

    async function exchange() {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

      try {
        console.log("[AuthCallback] Starting code exchange...")
        setStatus("Verifying identity...")

        const res = await fetch(`/api/auth/callback?code=${code}&state=${state}`, {
          headers: { "Accept": "application/json" },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        const contentType = res.headers.get("content-type")
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text()
          console.error("[AuthCallback] Expected JSON but received:", text.slice(0, 200))
          throw new Error("Server returned an invalid response (not JSON).")
        }

        const data = await res.json()
        if (cancelled) return

        if (res.ok && data.token) {
          console.log("[AuthCallback] Exchange successful, redirecting home.")
          // Use a full-page redirect so the app shell remounts and captures the JWT deterministically.
          window.location.replace(`/?auth_token=${encodeURIComponent(data.token)}`)
        } else {
          const msg = data.error || "Failed to exchange authorization code."
          console.warn("[AuthCallback] Exchange failed:", msg)
          window.location.replace(`/?auth_error=${encodeURIComponent(msg)}`)
        }
      } catch (err) {
        clearTimeout(timeoutId)
        if (cancelled) return
        
        if (err instanceof Error && err.name === "AbortError") {
          console.error("[AuthCallback] Exchange timed out.")
          setError("Connection timed out. Discord API or Worker might be slow.")
        } else {
          console.error("[AuthCallback] Auth exchange failed:", err)
          setError(err instanceof Error ? err.message : "Connection failed.")
        }
      }
    }

    void exchange()
    return () => { cancelled = true }
  }, [code, state, oauthError, error, navigate])

  return (
    <div className="layout-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", textAlign: "center", gap: "1rem" }}>
      {error ? (
        <>
          <h2 style={{ color: "var(--text-primary)" }}>Authentication Error</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "400px" }}>{error}</p>
          <button 
            className="btn btn-primary" 
            onClick={() => navigate("/", { replace: true })}
            style={{ marginTop: "1rem" }}
          >
            ← Back to Home
          </button>
        </>
      ) : (
        <>
          <div className="loading-spinner" style={{ width: "40px", height: "40px", border: "3px solid rgba(88, 101, 242, 0.1)", borderTopColor: "#5865F2", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>{status}</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </>
      )}
    </div>
  )
}
