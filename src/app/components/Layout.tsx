import { useState, useCallback, useRef } from "react"
import { Outlet, Link } from "react-router"
import { BYOKModal } from "./BYOKModal"
import { PortalTooltip } from "./Tooltip"
import { KeyStore } from "../lib/byok"
import type { ReactNode } from "react"

export interface LayoutOutletContext {
  setHeaderCenter: (node: ReactNode) => void
  setHeaderRight: (node: ReactNode) => void
  openBYOK: () => void
}

export function Layout() {
  const [showBYOK, setShowBYOK] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const byokRef = useRef<HTMLButtonElement>(null)
  const [headerCenter, setHeaderCenterState] = useState<ReactNode>(null)
  const [headerRight, setHeaderRightState] = useState<ReactNode>(null)
  const hasKey = KeyStore.has()

  const setHeaderCenter = useCallback((node: ReactNode) => {
    setHeaderCenterState(node)
  }, [])

  const setHeaderRight = useCallback((node: ReactNode) => {
    setHeaderRightState(node)
  }, [])

  const openBYOK = useCallback(() => {
    setShowBYOK(true)
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
              ref={byokRef}
              className={`btn-minimal-key ${hasKey ? "has-key" : ""}`}
              onClick={openBYOK}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              id="byok-trigger"
              aria-label={hasKey ? "Key Set" : "BYOK"}
            >
              🔑
            </button>
            <PortalTooltip 
              text={hasKey ? "AI Active" : "Set AI Key"} 
              anchorRef={byokRef} 
              visible={showTooltip} 
            />
          </div>
        </div>
      </header>

      <main className="layout-main">
        <Outlet context={{ setHeaderCenter, setHeaderRight, openBYOK } satisfies LayoutOutletContext} />
      </main>

      <footer className="layout-footer">
        <div className="layout-footer-content">
          <span className="layout-footer-name">Ordinal Mind</span>
          <a 
            href="https://github.com/Lipe-lx/ordinal-mind" 
            target="_blank" 
            rel="noopener noreferrer"
            className="layout-footer-link"
            title="View on GitHub"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
          </a>
        </div>
      </footer>

      {showBYOK && <BYOKModal onClose={() => setShowBYOK(false)} />}
    </div>
  )
}
