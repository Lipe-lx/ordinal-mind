import { useRouteError, isRouteErrorResponse, Link } from "react-router"

export function ErrorBoundary() {
  const error = useRouteError()

  let title = "Something went wrong"
  let message = "An unexpected error occurred. Please try again."
  let details: string | null = null

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = window.location.pathname.startsWith("/api/") ? "Service Not Found" : "Page Not Found"
      // If it looks like a chronicle route, use the inscription-specific title
      if (window.location.pathname.startsWith("/chronicle/")) {
        title = "Inscription Not Found"
      }
    } else {
      title = `Error ${error.status}`
    }
    message = error.data ?? error.statusText
  } else if (error instanceof Error) {
    message = error.message
    details = error.stack ?? null
  }

  return (
    <div className="layout">
      <div className="layout-main">
        <div className="error-boundary fade-in">
          <h2>{title}</h2>
          <p>{message}</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link to="/" className="btn btn-primary">
              ← Go Home
            </Link>
            <button
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
          {details && (
            <details>
              <summary style={{ cursor: "pointer", color: "var(--text-tertiary)", fontSize: "0.813rem" }}>
                Technical details
              </summary>
              <pre className="error-details">{details}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
