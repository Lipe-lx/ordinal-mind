// Detects whether the input is an inscription number, hex ID, or taproot address.
// Normalizes the input and resolves inscription numbers to hex IDs via ordinals.com.

export interface ResolvedInput {
  type: "inscription" | "address"
  value: string
}

const TAPROOT_RE = /^bc1p[a-z0-9]{38,62}$/i
const HEX_ID_RE = /^[a-f0-9]{64}i[0-9]+$/i
const NUMBER_RE = /^\d+$/

export async function resolveInput(raw: string): Promise<ResolvedInput> {
  const v = raw.trim()

  if (TAPROOT_RE.test(v)) {
    return { type: "address", value: v.toLowerCase() }
  }

  if (HEX_ID_RE.test(v)) {
    return { type: "inscription", value: v.toLowerCase() }
  }

  if (NUMBER_RE.test(v)) {
    const id = await resolveNumberToId(parseInt(v, 10))
    return { type: "inscription", value: id }
  }

  throw new Error("invalid input: use inscription number, hex ID, or bc1p address")
}

async function resolveNumberToId(num: number): Promise<string> {
  const res = await fetch(`https://ordinals.com/inscription/${num}`)
  if (!res.ok) throw new Error(`inscription #${num} not found`)
  
  const html = await res.text()
  const match = html.match(/\/content\/([a-f0-9]{64}i[0-9]+)/i)
  
  if (match && match[1]) {
    return match[1]
  }
  
  throw new Error(`inscription #${num} id could not be resolved`)
}
