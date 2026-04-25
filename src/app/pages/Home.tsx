import { useState, useTransition } from "react"
import { useNavigate } from "react-router"

const TAPROOT_RE = /^bc1p[a-z0-9]{38,62}$/i
const HEX_ID_RE = /^[a-f0-9]{64}i[0-9]+$/i
const NUMBER_RE = /^\d+$/

function isValidInput(v: string): boolean {
  return TAPROOT_RE.test(v) || HEX_ID_RE.test(v) || NUMBER_RE.test(v)
}

export function Home() {
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const navigate = useNavigate()

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
      navigate(`/chronicle/${encodeURIComponent(trimmed)}`)
    })
  }

  return (
    <div className="home fade-in">
      <div>
        <h1 className="home-title">
          <span className="home-title-accent">Factual Chronicle</span>
          <br />
          for Bitcoin Ordinals
        </h1>
      </div>

      <p className="home-subtitle">
        Explore the verifiable history of any inscription. On-chain provenance,
        transfer timeline, social mentions — all from public data.
      </p>

      <form className="home-search" onSubmit={handleSubmit}>
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
        <button
          id="scan-button"
          className="btn btn-primary"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Scanning..." : "Scan"}
        </button>
      </form>

      {error && <p className="home-error">{error}</p>}

      <p className="home-hint">
        Try: <button className="btn btn-ghost" type="button" onClick={() => setInput("0")} style={{ fontSize: "0.813rem" }}>#0</button>
        {" "}
        <button className="btn btn-ghost" type="button" onClick={() => setInput("69420")} style={{ fontSize: "0.813rem" }}>#69420</button>
        {" "}
        <button className="btn btn-ghost" type="button" onClick={() => setInput("1000")} style={{ fontSize: "0.813rem" }}>#1000</button>
      </p>
    </div>
  )
}
