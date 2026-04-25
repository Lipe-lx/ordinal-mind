import { useEffect, useReducer, useCallback } from "react"
import { useLoaderData, Link, useNavigate } from "react-router"
import { TemporalTree } from "../components/TemporalTree"
import { ChronicleCard } from "../components/ChronicleCard"
import { SatBadge } from "../components/SatBadge"
import { ScanProgress } from "../components/ScanProgress"
import { OwnershipWidget } from "../components/widgets/OwnershipWidget"
import { useSynthesize } from "../lib/byok/useSynthesize"
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
function useChronicleStream(id: string) {
  const [state, dispatch] = useReducer(streamReducer, initialState)

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/chronicle?id=${encodeURIComponent(id)}&stream=1`
    )

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
  }, [id, state.attempt])

  const retry = useCallback(() => {
    dispatch({ type: "RESET" })
  }, [])

  return { ...state, retry }
}

export function Chronicle() {
  const { id } = useLoaderData() as LoaderData
  const { chronicle, progress, error, isScanning, retry } = useChronicleStream(id)
  const {
    narrative,
    streamingText,
    phase,
    elapsed,
    error: synthError,
    lastInputMode,
    synthesize,
    cancel,
  } = useSynthesize()
  const navigate = useNavigate()

  // Scanning phase: show progress
  if (isScanning && !chronicle) {
    return (
      <div className="fade-in" style={{ maxWidth: "480px", margin: "0 auto" }}>
        <div className="chronicle-header" style={{ marginBottom: "1.5rem" }}>
          <button onClick={() => navigate("/")} className="btn btn-ghost">← Back</button>
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
          <button onClick={() => navigate("/")} className="btn btn-ghost">← Back</button>
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

  function handleShare() {
    const text = `Inscription #${chronicle.meta.inscription_number} — ${chronicle.events.length} events in its Chronicle. Explore on Ordinal Mind.`
    const url = window.location.href

    if (navigator.share) {
      navigator.share({ title: "Ordinal Mind Chronicle", text, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(`${text}\n${url}`).catch(() => {})
    }
  }

  // Chronicle loaded — render full view
  return (
    <div className="chronicle-page fade-in">
      <div className="chronicle-header">
        <div className="chronicle-header-left">
          <button onClick={() => navigate("/")} className="btn btn-ghost">← Back</button>
          <h1>
            Inscription{" "}
            <span className="chronicle-header-number">
              #{chronicle.meta.inscription_number}
            </span>
          </h1>
          <SatBadge rarity={chronicle.meta.sat_rarity} />
        </div>
        <div className="chronicle-header-right">
          <button
            className="btn btn-share-header"
            onClick={handleShare}
            title="Share this Chronicle"
          >
            ✦ Share
          </button>
        </div>
      </div>

      <div className="chronicle">
        {/* Left: Card with image + narrative */}
        <ChronicleCard
          chronicle={chronicle}
          narrative={narrative}
          streamingText={streamingText}
          phase={phase}
          elapsed={elapsed}
          synthError={synthError}
          lastInputMode={lastInputMode}
          onSynthesize={() => synthesize(chronicle)}
          onCancel={cancel}
        />

        {/* Right: Timeline in its own scrollable panel */}
        <div className="timeline-panel">
          <div className="timeline-panel-title">
            <span>Temporal Timeline</span>
            <OwnershipWidget
              events={chronicle.events}
              genesisAddress={chronicle.meta.genesis_owner_address}
              currentOwnerAddress={chronicle.meta.owner_address}
            />
          </div>
          <TemporalTree events={chronicle.events} />
        </div>
      </div>
    </div>
  )
}
