import { useState, useCallback, useRef } from "react"
import { createAdapter, KeyStore } from "./index"
import { sanitizeNarrative } from "./sanitizer"
import { ToolExecutor, type ResearchLog } from "./toolExecutor"
import type { Chronicle } from "../types"
import type { SynthesisMode } from "./context"

export type SynthesisPhase =
  | "idle"
  | "connecting"
  | "analyzing"
  | "researching"
  | "streaming"
  | "sanitizing"
  | "done"
  | "error"

export interface SynthesisState {
  /** Final sanitized narrative (null until complete) */
  narrative: string | null
  /** Progressive streaming text (raw, shown during generation) */
  streamingText: string
  /** Current synthesis phase */
  phase: SynthesisPhase
  /** Error message if synthesis failed */
  error: string | null
  /** Whether synthesis is in progress */
  loading: boolean
  /** Elapsed time in seconds since synthesis started */
  elapsed: number
}

export function useSynthesize() {
  const [narrative, setNarrative] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState("")
  const [phase, setPhase] = useState<SynthesisPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [lastInputMode, setLastInputMode] = useState<SynthesisMode | null>(null)
  const [researchLogs, setResearchLogs] = useState<ResearchLog[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    const start = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    clearTimer()
    setPhase("idle")
    setStreamingText("")
    setResearchLogs([])
    setLastInputMode(null)
  }, [clearTimer])

  const synthesize = useCallback(
    async (chronicle: Chronicle) => {
      // Cancel any in-progress synthesis
      abortRef.current?.abort()

      const config = KeyStore.get()
      if (!config || !config.key) {
        setError("Set your API key first (BYOK button in the header)")
        setPhase("error")
        return
      }

      const adapter = createAdapter(config)
      if (!adapter) {
        setError("Invalid configuration. Check your provider and key.")
        setPhase("error")
        return
      }

      // Reset state
      setError(null)
      setNarrative(null)
      setStreamingText("")
      setPhase("connecting")
      setResearchLogs([])
      setLastInputMode(null)
      startTimer()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        if (config.researchKeys && Object.keys(config.researchKeys).length > 0) {
          setPhase("researching")
        } else {
          setPhase("analyzing")
        }

        const toolExecutor = new ToolExecutor(config.researchKeys || {}, (log) => {
          console.log("[useSynthesize] Tool Log:", log)
          setResearchLogs((prev) => {
            const index = prev.findIndex((l) => l.id === log.id)
            if (index !== -1) {
              const next = [...prev]
              next[index] = log
              return next
            }
            return [...prev, log]
          })
        })

        let firstChunk = true
        const result = await adapter.synthesizeStream(
          chronicle,
          (chunk: string) => {
            if (firstChunk) {
              setPhase("streaming")
              firstChunk = false
            }
            setStreamingText((prev) => prev + chunk)
          },
          controller.signal,
          toolExecutor
        )

        // Don't proceed if aborted
        if (controller.signal.aborted) {
          return
        }

        setPhase("sanitizing")
        setLastInputMode(result.inputMode)

        // Apply sanitizer to final accumulated text
        const clean = sanitizeNarrative(result.text)

        if (!clean) {
          setError("The AI returned an empty response. Try again or switch models.")
          setPhase("error")
          return
        }

        setNarrative(clean)
        setStreamingText("")
        setPhase("done")
      } catch (e) {
        if (controller.signal.aborted) {
          return
        }

        const message = e instanceof Error ? e.message : "Synthesis failed"
        console.error("Synthesis error:", e)
        setError(message)
        setPhase("error")
      } finally {
        clearTimer()
        abortRef.current = null
      }
    },
    [startTimer, clearTimer]
  )

  return {
    narrative,
    streamingText,
    phase,
    loading: phase !== "idle" && phase !== "done" && phase !== "error",
    error,
    elapsed,
    researchLogs,
    lastInputMode,
    synthesize,
    cancel,
  }
}
