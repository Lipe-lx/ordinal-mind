import { useState, type ChangeEvent } from "react"
import { motion, AnimatePresence } from "motion/react"
import { KeyStore, detectProvider, PROVIDERS, MODELS, type Provider, type ByokConfig } from "../lib/byok"
import type { ResearchKeys } from "../lib/byok/toolExecutor"
import { useDiscordIdentity } from "../lib/useDiscordIdentity"
import { downloadWikiExport } from "../lib/wikiExport"

interface Props {
  onClose: () => void
}

export function BYOKModal({ onClose }: Props) {
  const [config, setConfig] = useState<ByokConfig>(
    KeyStore.get() ?? { provider: "unknown", model: "", key: "", researchKeys: {} }
  )
  const [activeTab, setActiveTab] = useState<"llm" | "research" | "identity" | "wiki-export">("identity")
  const { identity, isLoading: identityLoading, connect, disconnect } = useDiscordIdentity()
  const [wikiExportState, setWikiExportState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [wikiExportMessage, setWikiExportMessage] = useState("")

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

  async function handleWikiExport() {
    if (!identity || wikiExportState === "loading") return

    setWikiExportState("loading")
    setWikiExportMessage("Preparing public wiki snapshot...")

    const result = await downloadWikiExport()

    if (result.status === "success") {
      setWikiExportState("success")
      setWikiExportMessage(result.filename ? `Saved ${result.filename}` : "Public wiki export saved.")
      return
    }

    if (result.status === "cancelled") {
      setWikiExportState("idle")
      setWikiExportMessage("")
      return
    }

    setWikiExportState("error")
    setWikiExportMessage(result.message ?? "Could not export the public wiki.")
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
          <button
            type="button"
            className="btn-close-minimal modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <h2>Configuration</h2>
          <p>
            Keys stay in this browser session only. Select your provider and model below.
          </p>

          <div className="byok-tabs">
            <button 
              className={`byok-tab-btn ${activeTab === "identity" ? "active" : ""}`}
              onClick={() => setActiveTab("identity")}
            >
              Identity
              {identity && (
                <span className={`identity-tier-dot tier-${identity.tier}`} />
              )}
            </button>
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
            <button
              className={`byok-tab-btn ${activeTab === "wiki-export" ? "active" : ""}`}
              onClick={() => setActiveTab("wiki-export")}
            >
              Public Wiki Export
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "0.5rem", minHeight: "340px" }}>
            <AnimatePresence mode="wait">
              {activeTab === "llm" && (
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
              )}

              {activeTab === "research" && (
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

              {activeTab === "identity" && (
                <motion.div
                  key="identity"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="identity-tab-content"
                >
                  {identityLoading ? (
                    <div className="identity-skeleton">
                      <div className="skeleton-avatar" />
                      <div className="skeleton-lines">
                        <div className="skeleton-line" />
                        <div className="skeleton-line short" />
                      </div>
                    </div>
                  ) : identity ? (
                    <div className="identity-connected">
                      <div className={`identity-avatar-wrap tier-border-${identity.tier}`}>
                        {identity.avatar ? (
                          <img
                            src={identity.avatar}
                            alt={identity.username}
                            className="identity-avatar"
                          />
                        ) : (
                          <div className="identity-avatar-placeholder">
                            {identity.username.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="identity-info">
                        <span className="identity-username">{identity.username}</span>
                        <span className={`identity-tier-badge tier-badge-${identity.tier}`}>
                          {identity.tier.toUpperCase()}
                        </span>
                        
                        {identity.badges && identity.badges.length > 0 && (
                          <div className="identity-badges-list">
                            {identity.badges.map((badge) => (
                              <div key={badge.name} className={`identity-badge-item badge-level-${badge.level}`}>
                                <svg className="identity-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                {badge.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn-ghost identity-disconnect-btn"
                        onClick={() => void disconnect()}
                        id="discord-disconnect-btn"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="identity-disconnected">
                      <div className="identity-discord-icon">
                        <svg width="32" height="24" viewBox="0 0 127.14 96.36" fill="currentColor">
                          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
                        </svg>
                      </div>
                      <p className="identity-description">
                        Connect your Discord to unlock OG tier contributions to the Wiki. Your identity is verified but optional — Chronicle and Timeline always work anonymously.
                      </p>
                      <button
                        className="btn identity-connect-btn"
                        onClick={connect}
                        id="discord-connect-btn"
                      >
                        Connect Discord
                      </button>
                      <p className="identity-anon-note">
                        Without Discord, contributions enter quarantine for manual review.
                      </p>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === "wiki-export" && (
                <motion.div
                  key="wiki-export"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="identity-tab-content"
                >
                  <div className={`identity-export-panel ${identity ? "" : "is-disabled"}`}>
                    <div className="identity-export-copy">
                      <span className="identity-export-label">Public Wiki Export</span>
                      <p className="identity-export-description">
                        Download the full public wiki as a portable ZIP with structured JSON and readable Markdown.
                      </p>
                    </div>

                    <div className="identity-export-meta">
                      <span className="identity-export-meta-chip">ZIP snapshot</span>
                      <span className="identity-export-meta-chip">JSON + Markdown</span>
                      <span className="identity-export-meta-chip">Public data only</span>
                    </div>

                    <button
                      type="button"
                      className={`identity-export-btn ${wikiExportState === "success" ? "is-success" : ""}`}
                      onClick={() => void handleWikiExport()}
                      disabled={!identity || wikiExportState === "loading"}
                      id="wiki-export-btn"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3v11" />
                        <path d="M7 10.5 12 15.5l5-5" />
                        <path d="M5 19h14" />
                      </svg>
                      <span>{wikiExportState === "loading" ? "Exporting..." : "Download Wiki"}</span>
                    </button>

                    <p className={`identity-export-status state-${wikiExportState}`}>
                      {identity
                        ? (wikiExportMessage || "Includes explicit canonical, draft, disputed, and unverified status markers.")
                        : "Login is required for this export action, even though the snapshot itself contains only public data."}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(activeTab === "llm" || activeTab === "research") && (
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
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
