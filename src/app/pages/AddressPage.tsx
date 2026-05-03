import { useEffect, useState, useCallback } from "react"
import { useLoaderData, useNavigate, useLocation, useOutletContext } from "react-router"
import type { AddressResponse, AddressInscriptionItem } from "../lib/types"
import type { LayoutOutletContext } from "../components/Layout"

interface LoaderData {
  address: string
}

function truncateAddress(address: string) {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

export function AddressPage() {
  const { address } = useLoaderData() as LoaderData
  const location = useLocation()
  const navigate = useNavigate()
  const { setHeaderCenter } = useOutletContext<LayoutOutletContext>()
  
  const [data, setData] = useState<AddressResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [inscriptions, setInscriptions] = useState<AddressInscriptionItem[]>([])
  
  // Set header
  useEffect(() => {
    setHeaderCenter(
      <h1 className="layout-header-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        Wallet <span style={{ color: "var(--accent-primary)", fontFamily: "var(--font-mono)", fontSize: "0.9em" }}>{truncateAddress(address)}</span>
      </h1>
    )
    return () => setHeaderCenter(null)
  }, [address, setHeaderCenter])

  const fetchInscriptions = useCallback(async (cursor = 0, isLoadMore = false) => {
    if (isLoadMore) {
      setIsLoadingMore(true)
    } else {
      setIsLoading(true)
      setData(null)
      setInscriptions([])
    }
    setError(null)
    
    try {
      const res = await fetch(`/api/chronicle?id=${encodeURIComponent(address)}&cursor=${cursor}&size=48`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || "Failed to fetch address data")
      }
      
      const responseData = await res.json() as AddressResponse
      setData(responseData)
      
      if (isLoadMore) {
        setInscriptions(prev => [...prev, ...responseData.inscriptions])
      } else {
        setInscriptions(responseData.inscriptions)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [address])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInscriptions(0, false)
  }, [fetchInscriptions])

  const handleLoadMore = () => {
    if (data && data.inscriptions.length > 0) {
      void fetchInscriptions(data.cursor + data.inscriptions.length, true)
    }
  }

  const navigateToChronicle = (id: string) => {
    navigate(`/chronicle/${id}${location.search}`)
  }

  if (isLoading && inscriptions.length === 0) {
    return (
      <div className="address-page fade-in">
        <div className="chronicle-header" style={{ alignSelf: "flex-start", marginBottom: "1rem" }}>
          <button onClick={() => navigate(`/${location.search}`)} className="btn btn-ghost">← Search</button>
        </div>
        <div className="address-list">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="address-item skeleton">
              <div className="address-item-preview"></div>
              <div className="address-item-footer">
                <div style={{ height: "14px", width: "60px", background: "var(--bg-surface)", borderRadius: "4px" }}></div>
                <div style={{ height: "12px", width: "40px", background: "var(--bg-surface)", borderRadius: "4px", marginTop: "4px" }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error && inscriptions.length === 0) {
    return (
      <div className="address-page fade-in" style={{ alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
        <div className="glass-card" style={{ padding: "var(--space-2xl)", textAlign: "center", maxWidth: "480px" }}>
          <h3 style={{ color: "var(--danger)", marginBottom: "var(--space-md)" }}>Unable to load wallet</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-xl)" }}>{error}</p>
          <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center" }}>
            <button className="btn btn-secondary" onClick={() => navigate(`/${location.search}`)}>Go Back</button>
            <button className="btn btn-primary" onClick={() => fetchInscriptions()}>Try Again</button>
          </div>
        </div>
      </div>
    )
  }

  if (inscriptions.length === 0) {
    return (
      <div className="address-page fade-in">
        <div className="chronicle-header" style={{ alignSelf: "flex-start" }}>
          <button onClick={() => navigate(`/${location.search}`)} className="btn btn-ghost">← Search</button>
        </div>
        
        <div className="glass-card address-empty-state">
          <div className="address-empty-icon">📭</div>
          <h2 className="address-empty-title">No inscriptions found</h2>
          <p className="address-empty-desc">
            This wallet address doesn't seem to hold any inscriptions at the moment, or they might be abandoned/unconfirmed.
          </p>
          <button className="btn btn-primary" style={{ marginTop: "var(--space-md)" }} onClick={() => navigate(`/${location.search}`)}>
            Search another address
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="address-page fade-in">
      <div className="chronicle-header" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <button onClick={() => navigate(`/${location.search}`)} className="btn btn-ghost">← Search</button>
        {data && (
          <div className="address-stats fade-in">
            {data.total} inscription{data.total !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="address-list">
        {inscriptions.map((item, index) => {
          const isImage = item.content_type?.startsWith("image/")
          const simpleType = item.content_type?.split(";")[0].split("/")[1] || "unknown"
          
          return (
            <div 
              key={`${item.id}-${index}`} 
              className="address-item fade-in" 
              style={{ animationDelay: `${(index % 12) * 50}ms` }}
              onClick={() => navigateToChronicle(item.id)}
            >
              <div className="address-item-preview">
                {isImage ? (
                  <img 
                    src={item.content_url} 
                    alt={`Inscription #${item.number}`}
                    loading="lazy"
                    onError={(e) => {
                      // Fallback if image fails to load
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div 
                  className="address-item-preview-fallback" 
                  style={{ display: isImage ? 'none' : 'flex' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {item.content_type?.startsWith("text/") ? (
                      <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>
                    ) : item.content_type?.startsWith("audio/") ? (
                      <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>
                    ) : item.content_type?.startsWith("video/") ? (
                      <><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></>
                    ) : (
                      <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/></>
                    )}
                  </svg>
                  <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>.{simpleType}</span>
                </div>
              </div>
              <div className="address-item-footer">
                <span className="address-item-number">#{item.number}</span>
                <span className="address-item-type">{simpleType}</span>
              </div>
            </div>
          )
        })}
      </div>

      {data && inscriptions.length < data.total && (
        <div className="address-pagination">
          <button 
            className="btn btn-secondary" 
            onClick={handleLoadMore} 
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  )
}
