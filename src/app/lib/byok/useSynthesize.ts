import { useState, useCallback, useTransition } from "react"
import { createAdapter, KeyStore } from "./index"
import type { Chronicle } from "../types"

export function useSynthesize() {
  const [narrative, setNarrative] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const synthesize = useCallback(
    (chronicle: Chronicle) => {
      const config = KeyStore.get()
      if (!config || !config.key) {
        setError("Set your API key first (BYOK button in the header)")
        return
      }

      const adapter = createAdapter(config)
      if (!adapter) {
        setError("Invalid configuration. Check your provider and key.")
        return
      }

      setError(null)

      startTransition(async () => {
        try {
          const text = await adapter.synthesize(chronicle.meta, chronicle.events)
          
          // Sanitize text from AI model leaking thoughts or system prompts
          let cleanText = text
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/<system>[\s\S]*?<\/system>/gi, '')
            .replace(/<instructions>[\s\S]*?<\/instructions>/gi, '')
            .trim()
            
          setNarrative(cleanText)
        } catch (e) {
          setError(e instanceof Error ? e.message : "Synthesis failed")
        }
      })
    },
    []
  )

  return { narrative, loading: isPending, error, synthesize }
}
