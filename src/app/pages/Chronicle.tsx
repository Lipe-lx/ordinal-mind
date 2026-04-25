import { useEffect, useReducer, useCallback } from "react"
import { useLoaderData, Link } from "react-router"
import { TemporalTree } from "../components/TemporalTree"
import { ChronicleCard } from "../components/ChronicleCard"
import { SatBadge } from "../components/SatBadge"
import { ScanProgress } from "../components/ScanProgress"
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
  const { narrative, loading: synthLoading, error: synthError, synthesize } = useSynthesize()

  // Scanning phase: show progress
  if (isScanning && !chronicle) {
    return (
      <div className="fade-in" style={{ maxWidth: "480px", margin: "0 auto" }}>
        <div className="chronicle-header" style={{ marginBottom: "1.5rem" }}>
          <Link to="/" className="btn btn-ghost">← Back</Link>
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
          <Link to="/" className="btn btn-ghost">← Back</Link>
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

  // Chronicle loaded — render full view
  return (
    <div className="chronicle-page fade-in">
      <div className="chronicle-header">
        <Link to="/" className="btn btn-ghost">← Back</Link>
        <h1>
          Inscription{" "}
          <span className="chronicle-header-number">
            #{chronicle.meta.inscription_number}
          </span>
        </h1>
        <SatBadge rarity={chronicle.meta.sat_rarity} />
      </div>

      <div className="chronicle">
        {/* Left: Card with image + narrative */}
        <ChronicleCard
          chronicle={chronicle}
          narrative={narrative}
          synthLoading={synthLoading}
          synthError={synthError}
          onSynthesize={() => synthesize(chronicle)}
        />

        {/* Right: Timeline in its own scrollable panel */}
        <div className="timeline-panel">
          <div className="timeline-panel-title">
            Temporal Timeline
            <span className="timeline-panel-count">
              {chronicle.events.length} events
            </span>
          </div>
          <TemporalTree events={chronicle.events} />
        </div>
      </div>
    </div>
  )
}
