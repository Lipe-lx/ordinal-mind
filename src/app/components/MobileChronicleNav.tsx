import React from "react"

export type MobileTab = "metadata" | "narrative" | "timeline"

interface MobileChronicleNavProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
}

const TABS: { id: MobileTab; label: string; subLabel: string }[] = [
  { id: "metadata", label: "Metadata", subLabel: "Asset Info" },
  { id: "narrative", label: "Chronicle", subLabel: "Narrative" },
  { id: "timeline", label: "Timeline", subLabel: "Provenance" },
]

export function MobileChronicleNav({ activeTab, onTabChange }: MobileChronicleNavProps) {
  const currentIndex = TABS.findIndex((t) => t.id === activeTab)
  const currentTab = TABS[currentIndex]

  const goPrev = () => {
    if (currentIndex > 0) {
      onTabChange(TABS[currentIndex - 1].id)
    }
  }

  const goNext = () => {
    if (currentIndex < TABS.length - 1) {
      onTabChange(TABS[currentIndex + 1].id)
    }
  }

  return (
    <div className="mobile-chronicle-nav">
      <button 
        className="mobile-nav-btn" 
        onClick={goPrev} 
        disabled={currentIndex === 0}
        aria-label="Previous Section"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className="mobile-nav-title-group">
        <span className="mobile-nav-label">{currentTab.subLabel}</span>
        <span className="mobile-nav-title">{currentTab.label}</span>
        <div className="mobile-nav-indicators">
          {TABS.map((tab) => (
            <div 
              key={tab.id} 
              className={`mobile-nav-dot ${tab.id === activeTab ? "active" : ""}`} 
            />
          ))}
        </div>
      </div>

      <button 
        className="mobile-nav-btn" 
        onClick={goNext} 
        disabled={currentIndex === TABS.length - 1}
        aria-label="Next Section"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  )
}
