import type { ChronicleEvent } from "../../lib/types"

interface Props {
  events: ChronicleEvent[]
  genesisAddress?: string
  currentOwnerAddress?: string
}

interface OwnershipNode {
  address: string
  date: string
  type: "genesis" | "transfer" | "sale"
}

/** Horizontal ownership chain showing the transfer history of the inscription. Designed for header placement. */
export function OwnershipWidget({ events, genesisAddress, currentOwnerAddress }: Props) {
  const chain = buildOwnershipChain(events, genesisAddress, currentOwnerAddress)
  const txCount = events.filter((e) => e.event_type === "genesis" || e.event_type === "transfer" || e.event_type === "sale").length

  if (chain.length === 0) {
    return (
      <div className="widget-ownership-chain widget-empty">
        <span className="widget-empty-text">No transfers recorded</span>
      </div>
    )
  }

  const initial = chain[0]
  const final = chain.length > 1 ? chain[chain.length - 1] : null

  return (
    <div className="widget-ownership-chain condensed">
      {/* Initial Owner */}
      <div className="widget-ownership-node">
        <div className="widget-ownership-item vertical">
          <a
            className="widget-address-pill"
            href={`https://mempool.space/address/${initial.address}`}
            target="_blank"
            rel="noopener noreferrer"
            title={initial.address}
          >
            <span className="widget-ownership-type-icon" title="Genesis">⛏️</span>
            {truncateAddr(initial.address)}
          </a>
          <span className="widget-ownership-date">{formatShortDate(initial.date)}</span>
        </div>
      </div>

      {/* Connection with Tx Badge */}
      {final && (
        <>
          <div className="widget-ownership-connector">
            <span className="widget-ownership-arrow">→</span>
            <span className="widget-ownership-tx-badge" title={`${txCount} on-chain transactions total`}>
              {txCount}
            </span>
          </div>

          {/* Current Owner */}
          <div className="widget-ownership-node">
            <div className="widget-ownership-item vertical">
              <a
                className="widget-address-pill"
                href={`https://mempool.space/address/${final.address}`}
                target="_blank"
                rel="noopener noreferrer"
                title={final.address}
              >
                {final.type === "sale" && (
                  <span className="widget-ownership-type-icon" title="Sale">💰</span>
                )}
                {truncateAddr(final.address)}
              </a>
              <span className="widget-ownership-date">{formatShortDate(final.date)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// --- Helpers ---

function buildOwnershipChain(
  events: ChronicleEvent[],
  genesisAddress?: string,
  currentOwnerAddress?: string
): OwnershipNode[] {
  const chain: OwnershipNode[] = []

  // Sort events chronologically
  const sorted = [...events]
    .filter((e) => e.event_type === "genesis" || e.event_type === "transfer" || e.event_type === "sale")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  for (const event of sorted) {
    if (event.event_type === "genesis") {
      const addr = extractAddress(event) || genesisAddress || "unknown"
      chain.push({ address: addr, date: event.timestamp, type: "genesis" })
      continue
    }

    const toAddr = extractToAddress(event)
    if (toAddr) {
      // Skip self-transfers (same address in last position)
      const lastAddr = chain.length > 0 ? chain[chain.length - 1].address : null
      if (toAddr !== lastAddr) {
        chain.push({
          address: toAddr,
          date: event.timestamp,
          type: event.event_type as "transfer" | "sale",
        })
      }
    }
  }

  if (currentOwnerAddress) {
    const currentDate = sorted
      .filter((event) => event.event_type === "transfer" || event.event_type === "sale")
      .at(-1)?.timestamp
      ?? sorted.find((event) => event.event_type === "genesis")?.timestamp
      ?? new Date(0).toISOString()

    const lastAddr = chain.at(-1)?.address
    if (lastAddr !== currentOwnerAddress) {
      chain.push({
        address: currentOwnerAddress,
        date: currentDate,
        type: "transfer",
      })
    }
  }

  return chain
}

function extractAddress(event: ChronicleEvent): string | null {
  // Try metadata first, then parse description
  const meta = event.metadata as Record<string, unknown>
  if (meta?.address && typeof meta.address === "string") return meta.address
  if (meta?.owner && typeof meta.owner === "string") return meta.owner

  // Parse from description: "Inscribed on sat X by bc1p..."
  const match = event.description.match(/(bc1[a-z0-9]{8,})/i)
  return match ? match[1] : null
}

function extractToAddress(event: ChronicleEvent): string | null {
  const meta = event.metadata as Record<string, unknown>
  if (meta?.to && typeof meta.to === "string") return meta.to
  if (meta?.receiver && typeof meta.receiver === "string") return meta.receiver

  // Parse "→ bc1p..." or "to bc1p..." from description
  const match = event.description.match(/(?:→|to)\s*(bc1[a-z0-9]{8,})/i)
  return match ? match[1] : null
}

function truncateAddr(addr: string): string {
  if (!addr || addr.length < 16) return addr || "?"
  return `${addr.slice(0, 8)}…${addr.slice(-5)}`
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso.substring(0, 10)
  }
}
