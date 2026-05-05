import { useState, useTransition } from "react"
import { useLocation, useNavigate } from "react-router"
import { motion } from "motion/react"
import { OrdinalBackground } from "../components/OrdinalBackground"

const TAPROOT_RE = /^bc1p[a-z0-9]{38,62}$/i
const HEX_ID_RE = /^[a-f0-9]{64}i[0-9]+$/i
const NUMBER_RE = /^-?\d+$/

function isValidInput(v: string): boolean {
  return TAPROOT_RE.test(v) || HEX_ID_RE.test(v) || NUMBER_RE.test(v)
}

export function Home() {
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const navigate = useNavigate()
  const location = useLocation()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()

    if (!trimmed) {
      setError("Please enter an inscription number, hex ID, or taproot address.")
      return
    }

    if (!isValidInput(trimmed)) {
      setError("Invalid input. Use an inscription number (e.g. 69420), hex ID, or bc1p... address.")
      return
    }

    setError(null)
    startTransition(() => {
      if (TAPROOT_RE.test(trimmed)) {
        navigate(`/address/${encodeURIComponent(trimmed)}${location.search}`)
      } else {
        navigate(`/chronicle/${encodeURIComponent(trimmed)}${location.search}`)
      }
    })
  }

  return (
    <div className="home fade-in">
      <OrdinalBackground />
      
      <motion.div 
        className="home-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.h1 
          className="home-title"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="home-title-accent">The Memory Engine</span>
          <br />
          for Bitcoin Ordinals
        </motion.h1>

        <motion.p 
          className="home-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.9 }}
          transition={{ delay: 0.4, duration: 0.8 }}
        >
          Recover the provenance, traces, and cultural consensus of any digital artifact.
          Factual, public, and immutable — just like the chain.
        </motion.p>

        <motion.form 
          className="home-search" 
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8 }}
        >
          <div className="input-group">
            <input
              id="inscription-input"
              className="input-field"
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError(null)
              }}
              placeholder="Inscription # · hex ID · bc1p address"
              autoComplete="off"
              autoFocus
            />
          </div>
          <button
            id="scan-button"
            className="btn btn-primary effect-glow-pulse"
            type="submit"
            disabled={isPending}
          >
            {isPending ? "Scanning..." : "Scan Chronicle"}
          </button>
        </motion.form>

        {error && (
          <motion.p 
            className="home-error"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {error}
          </motion.p>
        )}

        <motion.div 
          className="home-hints"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.8 }}
        >
          <span className="home-hint-label">Explore History:</span>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("0")}>#0</button>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("69420")}>#69420</button>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("1000")}>#1000</button>
        </motion.div>
      </motion.div>
    </div>
  )
}
