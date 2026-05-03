import { useEffect, useState, useCallback } from "react"
import { useLoaderData, useNavigate, useLocation, useOutletContext } from "react-router"
import type { AddressResponse, AddressInscriptionItem } from "../lib/types"
import type { LayoutOutletContext } from "../components/Layout"
import { detectMediaKind } from "../lib/media"
import { NonImageFitPreview } from "../components/NonImageFitPreview"

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
          const kind = detectMediaKind(item.content_type || "unknown")
          const simpleType = item.content_type?.split(";")[0].split("/")[1] || "unknown"
          
          return (
            <div 
              key={`${item.id}-${index}`} 
              className="address-item fade-in" 
              style={{ animationDelay: `${(index % 12) * 50}ms`, position: "relative" }}
              onClick={() => navigateToChronicle(item.id)}
            >
              <div className="address-item-preview">
                {kind === "image" ? (
                  <img 
                    src={item.content_url} 
                    alt={`Inscription #${item.number}`}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : kind === "video" ? (
                  <video 
                    src={item.content_url} 
                    muted loop playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : kind === "audio" ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: "8px" }}>
                    <audio 
                      src={item.content_url} 
                      controls 
                      style={{ width: "100%", height: "30px", opacity: 0.8 }}
                    />
                  </div>
                ) : (
                  <NonImageFitPreview
                    kind={kind}
                    contentType={item.content_type || "unknown"}
                    contentUrl={item.content_url}
                    previewUrl={`https://ordinals.com/preview/${item.id}`}
                    mode="compact"
                    showMeta={false}
                  />
                )}
                
                {/* Fallback for failed images */}
                <div 
                  className="address-item-preview-fallback" 
                  style={{ display: 'none' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/>
                  </svg>
                  <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>.{simpleType}</span>
                </div>

                {/* Overlay to prevent iframes/videos from swallowing clicks */}
                <div style={{ position: "absolute", inset: 0, zIndex: 10, cursor: "pointer" }} />
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
