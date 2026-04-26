import { useState } from "react"
import { InscriptionPreview } from "./InscriptionPreview"
import { InscriptionMetaWidget } from "./widgets/InscriptionMetaWidget"
import { RarityWidget } from "./widgets/RarityWidget"
import type { ChronicleResponse } from "../lib/types"

interface Props {
  chronicle: ChronicleResponse
}

export function ChronicleSidebar({ chronicle: initialChronicle }: Props) {
  const [activeChronicle, setActiveChronicle] = useState(initialChronicle)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchTo = async (id: string) => {
    if (id === activeChronicle.meta.inscription_id) return
    
    setIsSwitching(true)
    setError(null)

    try {
      const res = await fetch(`/api/chronicle?id=${id}&lite=1`)
      if (!res.ok) throw new Error("Failed to load inscription data")
      const data = await res.json() as ChronicleResponse
      setActiveChronicle(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed")
    } finally {
      setIsSwitching(false)
    }
  }


  return (
    <div className="chronicle-sidebar-left">
      <InscriptionPreview key={activeChronicle.meta.inscription_id} 
        initialChronicle={initialChronicle}
        activeChronicle={activeChronicle}
        isSwitching={isSwitching}
        error={error}
        onSwitchTo={switchTo}
      />
      
      {!isSwitching && (
        <>
          <InscriptionMetaWidget 
            meta={activeChronicle.meta} 
            events={activeChronicle.events} 
          />
          <RarityWidget
            key={`${activeChronicle.meta.inscription_id}-rarity`}
            unisatEnrichment={activeChronicle.unisat_enrichment}
            validation={activeChronicle.validation}
          />
        </>
      )}
      
      {isSwitching && (
        <div className="glass-card" style={{ padding: "1.5rem", textAlign: "center", marginTop: "1rem" }}>
          <p style={{ color: "var(--text-secondary)" }}>Updating metadata…</p>
        </div>
      )}
    </div>
  )
}
