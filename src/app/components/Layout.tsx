import { useState } from "react"
import { Outlet, Link } from "react-router"
import { BYOKModal } from "./BYOKModal"
import { KeyStore } from "../lib/byok"

export function Layout() {
  const [showBYOK, setShowBYOK] = useState(false)
  const hasKey = KeyStore.has()

  return (
    <div className="layout">
      <header className="layout-header">
        <Link to="/" className="layout-logo">
          <span className="layout-logo-icon">◈</span>
          Ordinal Mind
        </Link>

        <div className="layout-actions">
          <button
            className="btn btn-ghost"
            onClick={() => setShowBYOK(true)}
            id="byok-trigger"
          >
            {hasKey ? "🔑 Key Set" : "🔑 BYOK"}
          </button>
        </div>
      </header>

      <main className="layout-main">
        <Outlet />
      </main>

      {showBYOK && <BYOKModal onClose={() => setShowBYOK(false)} />}
    </div>
  )
}
