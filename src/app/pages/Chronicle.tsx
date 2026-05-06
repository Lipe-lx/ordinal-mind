import { motion } from "motion/react"
import { useEffect, useReducer, useCallback, useState } from "react"
import { useLoaderData, useLocation, useNavigate, useOutletContext } from "react-router"
import { TemporalTree } from "../components/TemporalTree"
import { ChronicleCard } from "../components/ChronicleCard"
import { ChronicleSidebar } from "../components/ChronicleSidebar"
import { ScanProgress } from "../components/ScanProgress"
import { OwnershipWidget } from "../components/widgets/OwnershipWidget"
import { CollectionContextWidget } from "../components/widgets/CollectionContextWidget"
import { OrdinalBackground } from "../components/OrdinalBackground"
import { useChronicleNarrativeChat } from "../lib/byok/useChronicleNarrativeChat"
import type { LayoutOutletContext } from "../components/Layout"
import type { ChronicleResponse, ScanProgress as ScanProgressType } from "../lib/types"

interface LoaderData {
  id: string
}

// --- SSE stream state machine via useReducer (avoids setState in effect body) ---

interface StreamState {
  chronicle: ChronicleResponse | null
  progress: ScanProgressType | null
  error: string | null
  isScanning: boolean
  attempt: number
}

type StreamAction =
  | { type: "RESET" }
  | { type: "PROGRESS"; payload: ScanProgressType }
  | { type: "RESULT"; payload: ChronicleResponse }
  | { type: "ERROR"; payload: string }

const initialState: StreamState = {
  chronicle: null,
  progress: null,
  error: null,
  isScanning: true,
  attempt: 0,
}

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "RESET":
      return { ...initialState, attempt: state.attempt + 1 }
    case "PROGRESS":
      return { ...state, progress: action.payload }
    case "RESULT":
      return { ...state, chronicle: action.payload, isScanning: false }
    case "ERROR":
      return { ...state, error: action.payload, isScanning: false }
  }
}

/**
 * Hook to consume SSE stream from the Worker.
 * Uses useReducer to avoid calling setState synchronously within the effect body.
 */
function useChronicleStream(id: string, debug: boolean) {
  const [state, dispatch] = useReducer(streamReducer, initialState)


  useEffect(() => {
    const params = new URLSearchParams({
      id,
      stream: "1",
    })
    if (debug) params.set("debug", "1")

    const eventSource = new EventSource(`/api/chronicle?${params.toString()}`)

    eventSource.addEventListener("progress", (e) => {
      try {
        dispatch({ type: "PROGRESS", payload: JSON.parse(e.data) })
      } catch {
        // Ignore malformed progress events
      }
    })

    eventSource.addEventListener("result", (e) => {
      try {
        dispatch({ type: "RESULT", payload: JSON.parse(e.data) })
      } catch {
        dispatch({ type: "ERROR", payload: "Failed to parse chronicle data" })
      }
      eventSource.close()
    })

    eventSource.addEventListener("error", (e) => {
      if (e instanceof MessageEvent && e.data) {
        try {
          const data = JSON.parse(e.data)
          dispatch({ type: "ERROR", payload: data.message ?? "Connection error" })
        } catch {
          dispatch({ type: "ERROR", payload: "Connection lost" })
        }
      } else {
        dispatch({ type: "ERROR", payload: "Connection lost. The scan may have timed out." })
      }
      eventSource.close()
    })

    return () => {
      eventSource.close()
    }
  }, [debug, id, state.attempt])

  const retry = useCallback(() => {
    dispatch({ type: "RESET" })
  }, [])

  return { ...state, retry }
}

export function Chronicle() {
  const { id } = useLoaderData() as LoaderData
  const location = useLocation()
  const debug = new URLSearchParams(location.search).get("debug") === "1"
  const { chronicle, progress, error, isScanning, retry } = useChronicleStream(id, debug)
  const {
    messages,
    activeThreadId,
    threadHistory,
    streamingText,
    streamingThought,
    phase,
    elapsed,
    researchLogs,
    error: synthError,
    inputError,
    lastInputMode,
    wikiStatusLabel,
    wikiStatusError,
    wikiActivity,
    sendMessage,
    startNewThread,
    resumeThread,
    renameThread,
    deleteThread,
    editMessage,
    retryLast,
    cancel,
  } = useChronicleNarrativeChat(chronicle, { 
    wikiBuilderMode: new URLSearchParams(location.search).get("builderMode") === "true",
    targetGap: new URLSearchParams(location.search).get("gap") ?? undefined
  })
  const navigate = useNavigate()
  const homePath = `/${location.search}`
  const { setHeaderCenter, openBYOK } = useOutletContext<LayoutOutletContext>()
  const [rightSidebarMode, setRightSidebarMode] = useState<"provenance" | "timeline">("timeline")

  // Inject inscription title into Layout header when chronicle loads
  useEffect(() => {
    if (!chronicle) {
      setHeaderCenter(null)
      return
    }

    const fullLabel = chronicle.collection_context.presentation.full_label ?? chronicle.collection_context.presentation.item_label

    let headerContent: React.ReactNode
    if (fullLabel) {
      if (fullLabel.includes(" • ")) {
        const parts = fullLabel.split(" • ")
        const colName = parts[0]
        const itemName = parts.slice(1).join(" • ")
        headerContent = (
          <>
            {colName} <span style={{ opacity: 0.5 }}>•</span> <span style={{ color: "var(--accent-primary)" }}>{itemName}</span>
          </>
        )
      } else {
        headerContent = <span style={{ color: "var(--accent-primary)" }}>{fullLabel}</span>
      }
    } else {
      headerContent = (
        <>
          Inscription{" "}
          <span className="chronicle-header-number">
            #{chronicle.meta.inscription_number}
          </span>
        </>
      )
    }

    setHeaderCenter(
      <>
        <h1 className="layout-header-title">{headerContent}</h1>
      </>
    )

    return () => {
      setHeaderCenter(null)
    }
  }, [chronicle, setHeaderCenter])

  // Scanning phase: show progress
  if (isScanning && !chronicle) {
    return (
      <div key="scanning" className="home fade-in" style={{ justifyContent: "center", minHeight: "85vh" }}>
        <OrdinalBackground />
        
        <div className="home-content" style={{ width: "100%", maxWidth: "600px", gap: "var(--space-md)" }}>
          <div className="chronicle-header" style={{ marginBottom: 0, alignSelf: "flex-start" }}>
            <button onClick={() => navigate(homePath)} className="btn btn-ghost" style={{ paddingLeft: 0 }}>
              <span style={{ marginRight: "0.5rem" }}>←</span> Back to Search
            </button>
          </div>

          {progress ? (
            <ScanProgress progress={progress} inscriptionId={id} />
          ) : (
            <motion.div 
              className="scan-progress engine-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-lg)" }}
            >
              <div className="scan-progress-header" style={{ border: "none", marginBottom: 0, justifyContent: "center" }}>
                <div className="scan-progress-title-group" style={{ alignItems: "center" }}>
                  <div className="scan-progress-label">Temporal Index</div>
                  <h2 className="scan-progress-main-title">Initializing Engine</h2>
                </div>
              </div>
              
              <div className="initialization-visual">
                <div className="indicator-pulse active" />
              </div>

              <p style={{ color: "var(--text-tertiary)", fontSize: "0.85rem", maxWidth: "300px", margin: 0, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Establishing encrypted tunnel to the Bitcoin temporal ledger...
              </p>
            </motion.div>
          )}
        </div>
      </div>
    )
  }

  // Error state
  if (error && !chronicle) {
    return (
      <div key="error" className="fade-in" style={{ textAlign: "center" }}>
        <div className="chronicle-header" style={{ marginBottom: "var(--space-md)" }}>
          <button onClick={() => navigate(homePath)} className="btn btn-ghost">← Back</button>
        </div>
        <div className="glass-card" style={{ padding: "2rem" }}>
          <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>
            {error}
          </p>
          <button className="btn btn-primary" onClick={retry}>
            Retry Scan
          </button>
        </div>
      </div>
    )
  }

  // No data yet
  if (!chronicle) return null

  // Chronicle loaded — render 3-column layout
  return (
    <div key="loaded" className="chronicle-page fade-in">
      <div className="chronicle">
        {/* Left Sidebar: Inscription preview + metadata + rarity (unified hierarchy state) */}
        <ChronicleSidebar key={chronicle.meta.inscription_id} chronicle={chronicle} />

        {/* Center: Provenance, narrative, sources */}
        <ChronicleCard
          chronicle={chronicle}
          messages={messages}
          activeThreadId={activeThreadId}
          threadHistory={threadHistory}
          streamingText={streamingText}
          streamingThought={streamingThought}
          phase={phase}
          elapsed={elapsed}
          researchLogs={researchLogs}
          synthError={synthError}
          inputError={inputError}
          lastInputMode={lastInputMode}
          wikiStatusLabel={wikiStatusLabel}
          wikiStatusError={wikiStatusError}
          wikiActivity={wikiActivity}
          onSendMessage={sendMessage}
          onNewThread={startNewThread}
          onResumeThread={resumeThread}
          onRenameThread={renameThread}
          onDeleteThread={deleteThread}
          onEditMessage={editMessage}
          onRetryMessage={retryLast}
          onOpenBYOK={openBYOK}
          onCancel={cancel}
        />

        {/* Right Sidebar: Collection Context + Temporal Timeline */}
        <div className="chronicle-sidebar-right">
          <div style={{ 
            flex: rightSidebarMode === "provenance" ? 1 : 0, 
            minHeight: rightSidebarMode === "provenance" ? 0 : "fit-content",
            display: "flex",
            flexDirection: "column"
          }}>
            <CollectionContextWidget 
              collectionContext={chronicle.collection_context} 
              expanded={rightSidebarMode === "provenance"}
              onToggle={(isExpanded) => setRightSidebarMode(isExpanded ? "provenance" : "timeline")}
            />
          </div>
          
          <div className={`timeline-panel ${rightSidebarMode === "timeline" ? "expanded" : "collapsed"}`} style={{ 
            flex: rightSidebarMode === "timeline" ? 1 : 0, 
            minHeight: rightSidebarMode === "timeline" ? 0 : "fit-content" 
          }}>
            <button 
              className="timeline-panel-header" 
              onClick={() => setRightSidebarMode("timeline")}
              style={{ width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: rightSidebarMode === "timeline" ? "default" : "pointer" }}
            >
              <div className="timeline-panel-title" style={{ position: "relative" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: "8px" }}>
                  <span className="timeline-panel-title-text">Temporal Timeline</span>
                  <OwnershipWidget
                    events={chronicle.events}
                    genesisAddress={chronicle.meta.genesis_owner_address}
                    currentOwnerAddress={chronicle.meta.owner_address}
                  />
                </div>
                
                <div style={{ 
                  position: "absolute", 
                  right: "var(--space-md)", 
                  top: "50%", 
                  transform: "translateY(-50%)",
                  display: "flex",
                  alignItems: "center"
                }}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: rightSidebarMode === "timeline" ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease-out",
                      color: "var(--text-tertiary)",
                      opacity: rightSidebarMode === "timeline" ? 0 : 0.6
                    }}
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </div>
              </div>
            </button>
            {rightSidebarMode === "timeline" && (
              <div className="timeline-scroll-container">
                <TemporalTree 
                  events={chronicle.events} 
                  collectionSlug={chronicle.collection_context.market.ord_net_match?.collection_slug ?? chronicle.collection_context.market.satflow_match?.collection_slug} 
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
