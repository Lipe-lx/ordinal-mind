import { useState, useCallback } from "react"
import { Outlet, Link } from "react-router"
import { BYOKModal } from "./BYOKModal"
import { KeyStore } from "../lib/byok"
import type { ReactNode } from "react"

export interface LayoutOutletContext {
  setHeaderCenter: (node: ReactNode) => void
  setHeaderRight: (node: ReactNode) => void
}

export function Layout() {
  const [showBYOK, setShowBYOK] = useState(false)
  const [headerCenter, setHeaderCenterState] = useState<ReactNode>(null)
  const [headerRight, setHeaderRightState] = useState<ReactNode>(null)
  const hasKey = KeyStore.has()

  const setHeaderCenter = useCallback((node: ReactNode) => {
    setHeaderCenterState(node)
  }, [])

  const setHeaderRight = useCallback((node: ReactNode) => {
    setHeaderRightState(node)
  }, [])

  return (
    <div className="layout">
      <header className="layout-header">
        <div className="layout-header-left">
          <Link to="/" className="layout-logo">
            <span className="layout-logo-icon">◈</span>
            Ordinal Mind
          </Link>
        </div>

        {/* Center slot: Title + Badge */}
        <div className="layout-header-center">
          {headerCenter}
        </div>

        <div className="layout-header-right">
          {/* Right dynamic extras (e.g. Share button) */}
          {headerRight}
          
          <div className="layout-actions">
            <button
              className="btn btn-ghost"
              onClick={() => setShowBYOK(true)}
              id="byok-trigger"
            >
              {hasKey ? "🔑 Key Set" : "🔑 BYOK"}
            </button>
          </div>
        </div>
      </header>

      <main className="layout-main">
        <Outlet context={{ setHeaderCenter, setHeaderRight } satisfies LayoutOutletContext} />
      </main>

      {showBYOK && <BYOKModal onClose={() => setShowBYOK(false)} />}
    </div>
  )
}
