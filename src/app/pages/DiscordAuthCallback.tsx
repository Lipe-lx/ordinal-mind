import { useEffect, useState } from "react"
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
      navigate(`/?auth_error=${encodeURIComponent(oauthError)}`, { replace: true })
      return
    }

    // 2. If we already have a static error or missing params, don't proceed with exchange
    if (error || !code || !state) return

    async function exchange() {
      try {
        setStatus("Verifying identity...")

        // We call the actual worker endpoint. 
        // We MUST use Accept: application/json to get the token back instead of a 302 redirect.
        const res = await fetch(`/api/auth/callback?code=${code}&state=${state}`, {
          headers: { "Accept": "application/json" }
        })

        const data = await res.json()
        if (cancelled) return

        if (res.ok && data.token) {
          // Success! Redirect home with the token so useDiscordIdentity can pick it up.
          navigate(`/?auth_token=${encodeURIComponent(data.token)}`, { replace: true })
        } else {
          const msg = data.error || "Failed to exchange authorization code."
          navigate(`/?auth_error=${encodeURIComponent(msg)}`, { replace: true })
        }
      } catch (err) {
        if (cancelled) return
        console.error("Auth exchange failed:", err)
        setError(err instanceof Error ? err.message : "Connection failed.")
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
