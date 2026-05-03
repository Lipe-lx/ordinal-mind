import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"

export function DiscordAuthCallback() {
  const [searchParams] = useSearchParams()
  const errorParam = searchParams.get("error")
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const missingParams = !errorParam && (!code || !state)

  const [error, setError] = useState<string | null>(missingParams ? "Missing callback parameters." : null)

  useEffect(() => {
    if (errorParam) {
      window.location.href = `/?auth_error=${encodeURIComponent(errorParam)}`
      return
    }

    if (missingParams) return

    let ignore = false

    // Attempt AJAX callback to bypass Vite SPA fallback in local dev
    fetch(`/api/auth/callback?code=${encodeURIComponent(code!)}&state=${encodeURIComponent(state!)}`, {
      headers: { Accept: "application/json" }
    })
      .then(res => res.json())
      .then(data => {
        if (ignore) return
        if (data.token) {
          window.location.href = `/?auth_token=${encodeURIComponent(data.token)}`
        } else {
          throw new Error(data.error || "Authentication failed.")
        }
      })
      .catch(err => {
        if (ignore) return
        console.error(err)
        setError(err instanceof Error ? err.message : "Authentication failed.")
      })

    return () => { ignore = true }
  }, [code, state, errorParam, missingParams])

  return (
    <div className="layout" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        {error ? (
          <>
            <h2 style={{ color: "var(--danger)" }}>Authentication Failed</h2>
            <p>{error}</p>
            <button className="btn btn-secondary" onClick={() => window.location.href = "/"} style={{ marginTop: "1rem" }}>
              Return Home
            </button>
          </>
        ) : (
          <>
            <h2>Authenticating...</h2>
            <p style={{ color: "var(--text-secondary)" }}>Verifying your Discord identity...</p>
            <div className="spinner" style={{ marginTop: "1.5rem", display: "inline-block" }}></div>
          </>
        )}
      </div>
    </div>
  )
}
