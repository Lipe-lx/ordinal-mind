import { useState, useTransition } from "react"
import { useLocation, useNavigate } from "react-router"
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react"
import { OrdinalBackground } from "../components/OrdinalBackground"

const TAPROOT_RE = /^bc1p[a-z0-9]{38,62}$/i
const HEX_ID_RE = /^[a-f0-9]{64}i[0-9]+$/i
const NUMBER_RE = /^-?\d+$/

function isValidInput(v: string): boolean {
  return TAPROOT_RE.test(v) || HEX_ID_RE.test(v) || NUMBER_RE.test(v)
}

function DynamicLogo({ mouseX, mouseY }: { mouseX: MotionValue<number>, mouseY: MotionValue<number> }) {
  const springConfig = { stiffness: 250, damping: 15, mass: 0.8 }
  const x = useSpring(useTransform(mouseX, [-200, 200], [-60, 60]), springConfig)
  const y = useSpring(useTransform(mouseY, [-200, 200], [-60, 60]), springConfig)

  const rotateX = useTransform(y, [-60, 60], [25, -25])
  const rotateY = useTransform(x, [-60, 60], [-25, 25])

  return (
    <motion.div 
      className="home-hero-logo"
      style={{ 
        x, y, rotateX, rotateY, 
        perspective: 1200,
        cursor: "pointer",
      }}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ 
        scale: 1.2,
        filter: "drop-shadow(0 0 40px var(--accent-glow-strong))"
      }}
      whileTap={{ scale: 0.9 }}
      transition={{ 
        scale: { type: "spring", stiffness: 400, damping: 20 },
        opacity: { duration: 1.2 }
      }}
    >
      <svg width="120" height="120" viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="heroFlowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: "#F7931A", stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: "#FFAB40", stopOpacity: 1 }} />
          </linearGradient>
          <filter id="heroGlow">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        <motion.path 
          d="M 50,150 A 80,80 0 1,1 190,150 C 190,120 170,100 155,100 C 140,100 135,125 120,125 C 105,125 100,100 85,100 C 70,100 50,120 50,150 Z"
          stroke="url(#heroFlowGradient)" 
          strokeWidth="12" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          fill="none"
          filter="url(#heroGlow)"
          animate={{
            d: [
              "M 50,150 A 80,80 0 1,1 190,150 C 190,120 170,100 155,100 C 140,100 135,125 120,125 C 105,125 100,100 85,100 C 70,100 50,120 50,150 Z",
              "M 45,155 A 85,85 0 1,1 195,155 C 195,115 175,95 160,95 C 145,95 130,130 120,130 C 110,130 95,95 80,95 C 65,95 45,115 45,155 Z",
              "M 50,150 A 80,80 0 1,1 190,150 C 190,120 170,100 155,100 C 140,100 135,125 120,125 C 105,125 100,100 85,100 C 70,100 50,120 50,150 Z"
            ]
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <circle cx="120" cy="165" r="6" fill="#F7931A">
          <animate attributeName="opacity" values="1;0.4;1" dur="3s" repeatCount="indefinite" />
        </circle>
      </svg>
    </motion.div>
  )
}

export function Home() {
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const navigate = useNavigate()
  const location = useLocation()

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  // Mouse move handlers for dynamic hero effects

  function handleHeroMouseMove(e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    mouseX.set(e.clientX - centerX)
    mouseY.set(e.clientY - centerY)
  }

  function handleHeroMouseLeave() {
    mouseX.set(0)
    mouseY.set(0)
  }

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
        <div 
          className="home-hero-zone"
          onMouseMove={handleHeroMouseMove}
          onMouseLeave={handleHeroMouseLeave}
          style={{
            padding: "80px",
            margin: "-80px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 20
          }}
        >
          <div className="home-hero">
            <DynamicLogo mouseX={mouseX} mouseY={mouseY} />
            <motion.h1 
              className="home-title"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              Ordinal Mind
            </motion.h1>
          </div>
        </div>

        <motion.p 
          className="home-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {["Every", "Inscription", "has", "a", "history.", "Find it."].map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 5, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ 
                duration: 0.4, 
                delay: 0.5 + (i * 0.08),
                ease: "easeOut"
              }}
              style={{ display: "inline-block", marginRight: "0.25rem" }}
            >
              {word}
            </motion.span>
          ))}
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
            {isPending ? "Scanning..." : "Trace the Chronicle"}
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
          <span className="home-hint-label">QUICK TRACE:</span>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("0")}>#0</button>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("69420")}>#69420</button>
          <button className="btn btn-ghost" type="button" onClick={() => setInput("1000")}>#1000</button>
        </motion.div>
      </motion.div>
    </div>
  )
}
