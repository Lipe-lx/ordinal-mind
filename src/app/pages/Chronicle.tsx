import { useEffect, useReducer, useCallback, useRef } from "react"
import { useLoaderData, useLocation, useNavigate, useOutletContext } from "react-router"
import { TemporalTree } from "../components/TemporalTree"
import { ChronicleCard } from "../components/ChronicleCard"
import { ChronicleSidebar } from "../components/ChronicleSidebar"
import { ScanProgress } from "../components/ScanProgress"
import { OwnershipWidget } from "../components/widgets/OwnershipWidget"
import { KeyStore } from "../lib/byok"
import { useSynthesize } from "../lib/byok/useSynthesize"
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
    narrative,
    streamingText,
    phase,
    elapsed,
    researchLogs,
    error: synthError,
    lastInputMode,
    synthesize,
    cancel,
  } = useSynthesize()
  const navigate = useNavigate()
  const homePath = `/${location.search}`
  const { setHeaderCenter, setHeaderRight, openBYOK } = useOutletContext<LayoutOutletContext>()
  const autoSynthesizedRef = useRef<string | null>(null)

  // Inject inscription title + share into Layout header when chronicle loads
  useEffect(() => {
    if (!chronicle) {
      setHeaderCenter(null)
      setHeaderRight(null)
      return
    }

    const handleShare = () => {
      const fullLabel = chronicle.collection_context.presentation.full_label ?? chronicle.collection_context.presentation.item_label
      const label = fullLabel ? `${fullLabel} (#${chronicle.meta.inscription_number})` : `Inscription #${chronicle.meta.inscription_number}`
      const text = `${label} — ${chronicle.events.length} events in its Chronicle. Explore on Ordinal Mind.`
      const url = window.location.href

      if (navigator.share) {
        navigator.share({ title: "Ordinal Mind Chronicle", text, url }).catch(() => {})
      } else {
        navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {})
      }
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

    setHeaderRight(
      <button
        className="btn btn-share-header"
        onClick={handleShare}
        title="Share this Chronicle"
      >
        ✦ Share
      </button>
    )

    return () => {
      setHeaderCenter(null)
      setHeaderRight(null)
    }
  }, [chronicle, setHeaderCenter, setHeaderRight])

  useEffect(() => {
    if (!chronicle) return
    if (!KeyStore.has()) return
    if (narrative || streamingText) return
    if (phase !== "idle") return

    const autoKey = chronicle.meta.inscription_id
    if (autoSynthesizedRef.current === autoKey) return

    autoSynthesizedRef.current = autoKey
    synthesize(chronicle)
  }, [chronicle, narrative, phase, streamingText, synthesize])


  // Scanning phase: show progress
  if (isScanning && !chronicle) {
    return (
      <div className="fade-in" style={{ maxWidth: "480px", margin: "0 auto" }}>
        <div className="chronicle-header" style={{ marginBottom: "1.5rem" }}>
          <button onClick={() => navigate(homePath)} className="btn btn-ghost">← Back</button>
        </div>
        {progress ? (
          <ScanProgress progress={progress} inscriptionId={id} />
        ) : (
          <div className="scan-progress glass-card" style={{ textAlign: "center", padding: "2rem" }}>
            <span style={{ fontSize: "1.5rem" }}>⏳</span>
            <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              Connecting…
            </p>
          </div>
        )}
      </div>
    )
  }

  // Error state
  if (error && !chronicle) {
    return (
      <div className="fade-in" style={{ textAlign: "center" }}>
        <div className="chronicle-header" style={{ marginBottom: "1.5rem" }}>
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
    <div className="chronicle-page fade-in">
      <div className="chronicle">
        {/* Left Sidebar: Inscription preview + metadata + rarity (unified hierarchy state) */}
        <ChronicleSidebar key={chronicle.meta.inscription_id} chronicle={chronicle} />

        {/* Center: Provenance, narrative, sources */}
        <ChronicleCard
          chronicle={chronicle}
          narrative={narrative}
          streamingText={streamingText}
          phase={phase}
          elapsed={elapsed}
          researchLogs={researchLogs}
          synthError={synthError}
          lastInputMode={lastInputMode}
          onSynthesize={() => synthesize(chronicle)}
          onOpenBYOK={openBYOK}
          onCancel={cancel}
        />

        {/* Right Sidebar: Temporal Timeline */}
        <div className="timeline-panel">
          <div className="timeline-panel-title">
            <span className="timeline-panel-title-text">Temporal Timeline</span>
            <OwnershipWidget
              events={chronicle.events}
              genesisAddress={chronicle.meta.genesis_owner_address}
              currentOwnerAddress={chronicle.meta.owner_address}
            />
          </div>
          <div className="timeline-scroll-container">
            <TemporalTree events={chronicle.events} />
          </div>
        </div>
      </div>
    </div>
  )
}
