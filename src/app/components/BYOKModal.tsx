import { useState, type ChangeEvent } from "react"
import { motion, AnimatePresence } from "motion/react"
import { KeyStore, detectProvider, PROVIDERS, MODELS, type Provider, type ByokConfig } from "../lib/byok"
import type { ResearchKeys } from "../lib/byok/toolExecutor"

interface Props {
  onClose: () => void
}

export function BYOKModal({ onClose }: Props) {
  const [config, setConfig] = useState<ByokConfig>(
    KeyStore.get() ?? { provider: "unknown", model: "", key: "", researchKeys: {} }
  )
  const [activeTab, setActiveTab] = useState<"llm" | "research">("llm")

  function handleProviderChange(e: ChangeEvent<HTMLSelectElement>) {
    const newProvider = e.target.value as Provider
    if (newProvider === "unknown") return
    
    const validModels = MODELS[newProvider]
    const newModel = validModels && validModels.length > 0 && !validModels.find((m) => m.id === config.model)
      ? validModels[0].id
      : config.model

    setConfig((c) => ({ ...c, provider: newProvider, model: newModel }))
  }

  function handleKeyChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const autoProvider = detectProvider(val)
    if (autoProvider !== "unknown" && config.provider === "unknown") {
      const validModels = MODELS[autoProvider]
      const newModel = validModels && validModels.length > 0 && !validModels.find((m) => m.id === config.model)
        ? validModels[0].id
        : config.model
      setConfig((c) => ({ ...c, key: val, provider: autoProvider, model: newModel }))
    } else {
      setConfig((c) => ({ ...c, key: val }))
    }
  }

  function handleResearchKeyChange(keyName: keyof ResearchKeys, val: string) {
    setConfig((c) => ({
      ...c,
      researchKeys: { ...c.researchKeys, [keyName]: val }
    }))
  }

  const isValid = config.provider !== "unknown" && config.key.length > 10 && config.model

  function handleSave() {
    if (!isValid) return
    KeyStore.set({ ...config, key: config.key.trim() })
    onClose()
  }

  function handleClear() {
    KeyStore.clear()
    setConfig({ provider: "unknown", model: "", key: "", researchKeys: {} })
  }

  return (
    <AnimatePresence>
      <motion.div
        className="byok-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <motion.div
          className="byok-modal glass-card"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          <h2>Bring Your Own Key (BYOK)</h2>
          <p>
            Keys stay in this browser session only. Select your provider and model below.
          </p>

          <div className="byok-tabs">
            <button 
              className={`byok-tab-btn ${activeTab === "llm" ? "active" : ""}`}
              onClick={() => setActiveTab("llm")}
            >
              AI Engine
            </button>
            <button 
              className={`byok-tab-btn ${activeTab === "research" ? "active" : ""}`}
              onClick={() => setActiveTab("research")}
            >
              Research Tools
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "0.5rem", minHeight: "340px" }}>
            <AnimatePresence mode="wait">
              {activeTab === "llm" ? (
                <motion.div 
                  key="llm"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Provider</label>
                    <select
                      className="input-field"
                      value={config.provider}
                      onChange={handleProviderChange}
                    >
                      <option value="unknown" disabled>Select Provider...</option>
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {config.provider !== "unknown" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Model</label>
                      <select
                        className="input-field"
                        value={config.model}
                        onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                      >
                        {MODELS[config.provider]?.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>API Key</label>
                    <input
                      className="input-field"
                      type="password"
                      value={config.key}
                      onChange={handleKeyChange}
                      placeholder="Paste your API key here..."
                      autoComplete="off"
                      id="byok-key-input"
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="research"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
                >
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 0.5rem 0" }}>
                    Provide keys for specialized search tools to enable the autonomous research phase.
                  </p>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)" }}>Brave Search API Key</label>
                    <input
                      className="input-field"
                      type="password"
                      value={config.researchKeys?.braveSearchApiKey || ""}
                      onChange={(e) => handleResearchKeyChange("braveSearchApiKey", e.target.value)}
                      placeholder="BS..."
                      autoComplete="off"
                    />
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)" }}>Exa API Key</label>
                    <input
                      className="input-field"
                      type="password"
                      value={config.researchKeys?.exaApiKey || ""}
                      onChange={(e) => handleResearchKeyChange("exaApiKey", e.target.value)}
                      placeholder="exa..."
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)" }}>Perplexity API Key</label>
                    <input
                      className="input-field"
                      type="password"
                      value={config.researchKeys?.perplexityApiKey || ""}
                      onChange={(e) => handleResearchKeyChange("perplexityApiKey", e.target.value)}
                      placeholder="pplx..."
                      autoComplete="off"
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: "600", color: "var(--text-tertiary)" }}>SerpApi Key (Google Trends)</label>
                    <input
                      className="input-field"
                      type="password"
                      value={config.researchKeys?.serpapiApiKey || ""}
                      onChange={(e) => handleResearchKeyChange("serpapiApiKey", e.target.value)}
                      placeholder="serpapi..."
                      autoComplete="off"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="byok-actions" style={{ marginTop: "1.5rem" }}>
            <button className="btn btn-ghost" onClick={handleClear}>
              Clear
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!isValid}
              id="byok-save-btn"
            >
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
