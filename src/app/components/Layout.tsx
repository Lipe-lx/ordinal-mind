import { useState, useCallback, useRef, useEffect } from "react"
import { Outlet, Link, useLocation, useNavigate } from "react-router"
import { BYOKModal } from "./BYOKModal"
import { PortalTooltip } from "./Tooltip"
import { KeyStore } from "../lib/byok"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"
import { LogoIcon } from "./Logo"
import { WikiReviewModal } from "./WikiReviewModal"
import { useWikiReviewQueue } from "../lib/useWikiReviewQueue"
import { ToastContainer, type ToastProps } from "./Toast"
import type { ReactNode } from "react"

export interface LayoutOutletContext {
  setHeaderCenter: (node: ReactNode) => void
  setHeaderRight: (node: ReactNode) => void
  openBYOK: (tab?: "llm" | "research" | "identity" | "wiki-export") => void
}

type ToastData = Omit<ToastProps, "onClose">

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === "/"
  const [showBYOK, setShowBYOK] = useState(false)
  const [targetTab, setTargetTab] = useState<"llm" | "research" | "identity" | "wiki-export" | undefined>()
  const [showTooltip, setShowTooltip] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const byokRef = useRef<HTMLButtonElement>(null)
  const [headerCenter, setHeaderCenterState] = useState<ReactNode>(null)
  const [headerRight, setHeaderRightState] = useState<ReactNode>(null)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const lastErrorRef = useRef<string | null>(null)
  
  const hasKey = KeyStore.has()
  const { identity, isLoading: identityLoading, connect, authError } = useDiscordIdentity()
  const reviewQueue = useWikiReviewQueue(identity?.tier === "genesis")

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((toast: ToastData) => {
    setToasts((prev) => [...prev, toast])
  }, [])

  useEffect(() => {
    if (authError && authError !== lastErrorRef.current) {
      lastErrorRef.current = authError
      
      // Defer toast creation to avoid synchronous setState in effect warning
      setTimeout(() => {
        if (authError === "CAPACITY_REACHED") {
          addToast({
            id: `auth-capacity-${Date.now()}`,
            type: "warning",
            title: "Service Busy",
            message: "System capacity reached. We're experiencing high demand, please try connecting again later.",
            duration: 10000
          })
        } else {
          addToast({
            id: `auth-error-${Date.now()}`,
            type: "error",
            title: "Connection Failed",
            message: authError.length < 100 ? authError : "An unexpected error occurred during authentication."
          })
        }
      }, 0)
      
      if (location.hash.includes("auth_error") || location.search.includes("auth_error")) {
        navigate("/", { replace: true })
      }
    } else if (!authError) {
      lastErrorRef.current = null
    }
  }, [authError, addToast, navigate, location.hash, location.search])

  const setHeaderCenter = useCallback((node: ReactNode) => {
    setHeaderCenterState(node)
  }, [])

  const setHeaderRight = useCallback((node: ReactNode) => {
    setHeaderRightState(node)
  }, [])

  const openBYOK = useCallback((tab?: "llm" | "research" | "identity" | "wiki-export") => {
    setTargetTab(tab)
    setShowBYOK(true)
  }, [])

  return (
    <div className={`layout ${isHome ? "is-home" : ""}`}>
      <header className="layout-header">
        <div className="layout-header-left">
          {!isHome && (
            <Link to="/" className="layout-logo">
              <LogoIcon className="layout-logo-icon" />
              Ordinal Mind
            </Link>
          )}
        </div>

        {/* Center slot: Title + Badge */}
        <div className="layout-header-center">
          {headerCenter}
        </div>

        <div className="layout-header-right">
          {/* Right dynamic extras (e.g. Share button) */}
          {headerRight}
          
          <div className="layout-actions">
            {!identityLoading && (
              identity ? (
                <div className="layout-identity-cluster">
                  {identity.tier === "genesis" && reviewQueue.pendingCount > 0 && (
                    <button
                      type="button"
                      className="layout-review-trigger"
                      aria-label={`Open Genesis review inbox (${reviewQueue.pendingCount} pending)`}
                      title={`Genesis review inbox (${reviewQueue.pendingCount})`}
                      onClick={() => setShowReviewModal(true)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                        <path d="M10 20a2 2 0 0 0 4 0" />
                      </svg>
                      <span className="layout-review-badge">{reviewQueue.pendingCount > 9 ? "9+" : reviewQueue.pendingCount}</span>
                    </button>
                  )}

                  <div 
                    className={`identity-avatar-wrap tier-border-${identity.tier}`} 
                    style={{ width: "32px", height: "32px", cursor: "pointer" }}
                    title={`${identity.username} (${identity.tier})`}
                    onClick={() => openBYOK()}
                  >
                    {identity.avatar ? (
                      <img
                        src={identity.avatar}
                        alt={identity.username}
                        className="identity-avatar"
                        style={{ width: "100%", height: "100%", borderRadius: "50%" }}
                      />
                    ) : (
                      <div className="identity-avatar-placeholder" style={{ width: "100%", height: "100%", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem" }}>
                        {identity.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  className="btn-minimal-key layout-connect-btn"
                  onClick={connect}
                  aria-label="Connect Discord"
                  title="Connect Discord"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "0 0.75rem", borderRadius: "99px", background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)", fontSize: "0.85rem", fontWeight: 500, color: "var(--text-secondary)", transition: "all 0.2s ease" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(88, 101, 242, 0.1)"
                    e.currentTarget.style.borderColor = "rgba(88, 101, 242, 0.5)"
                    e.currentTarget.style.color = "#5865F2"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)"
                    e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)"
                    e.currentTarget.style.color = "var(--text-secondary)"
                  }}
                >
                  <svg width="16" height="12" viewBox="0 0 127.14 96.36" fill="currentColor">
                    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
                  </svg>
                  <span className="layout-connect-label">Connect</span>
                </button>
              )
            )}

            {!identity && !identityLoading && (
              <>
                <button
                  ref={byokRef}
                  className={`btn-minimal-key ${hasKey ? "has-key" : ""}`}
                  onClick={() => openBYOK()}
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  id="byok-trigger"
                  aria-label="Configuration"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>
                <PortalTooltip 
                  text="Configuration" 
                  anchorRef={byokRef} 
                  visible={showTooltip} 
                />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="layout-main">
        <Outlet context={{ setHeaderCenter, setHeaderRight, openBYOK } satisfies LayoutOutletContext} />
      </main>

      <footer className="layout-footer">
        <div className="layout-footer-content">
          <span className="layout-footer-name">Ordinal Mind</span>
          <div className="layout-footer-links">
            <Link to={`/docs${location.search}`} className="layout-footer-text-link">
              Docs
            </Link>
            <span className="layout-footer-divider" aria-hidden="true">•</span>
            <Link to={`/terms${location.search}`} className="layout-footer-text-link">
              Terms
            </Link>
            <span className="layout-footer-divider" aria-hidden="true">•</span>
            <Link to={`/policies${location.search}`} className="layout-footer-text-link">
              Policies
            </Link>
          </div>
          <a
            href="https://x.com/ordinalmind"
            target="_blank"
            rel="noopener noreferrer"
            className="layout-footer-link"
            title="Follow on X"
            aria-label="Follow Ordinal Mind on X"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.244 2H21l-6.56 7.5L22.5 22h-6.77l-5.3-6.93L4.34 22H1.58l7.02-8.02L1.5 2h6.94l4.79 6.31L18.244 2Zm-2.37 18h1.87L6.48 3.9H4.47L15.874 20Z" />
            </svg>
          </a>
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

      {showBYOK && (
        <BYOKModal 
          initialTab={targetTab} 
          onClose={() => {
            setShowBYOK(false)
            setTargetTab(undefined)
          }} 
        />
      )}
      <WikiReviewModal
        open={showReviewModal}
        items={reviewQueue.items}
        loading={reviewQueue.loading}
        error={reviewQueue.error}
        actingId={reviewQueue.actingId}
        onApprove={reviewQueue.approveReview}
        onReject={reviewQueue.rejectReview}
        onRefresh={reviewQueue.refresh}
        onClose={() => setShowReviewModal(false)}
      />
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
