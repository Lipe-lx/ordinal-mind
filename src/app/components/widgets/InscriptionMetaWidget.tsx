import type { InscriptionMeta, ChronicleEvent } from "../../lib/types"
import { SatBadge } from "../SatBadge"

interface Props {
  meta: InscriptionMeta
  events: ChronicleEvent[]
}

/** Grid-based key facts card for inscription at-a-glance data. */
export function InscriptionMetaWidget({ meta, events }: Props) {
  const genesisDate = meta.genesis_timestamp
    ? new Date(meta.genesis_timestamp).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

  const eventCount = events.length
  const transferCount = events.filter((e) => e.event_type === "transfer" || e.event_type === "sale").length
  const mentionCount = events.filter((e) => e.event_type === "x_mention").length

  const eventSummary = [
    transferCount > 0 ? `${transferCount} transfer${transferCount > 1 ? "s" : ""}` : null,
    mentionCount > 0 ? `${mentionCount} mention${mentionCount > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ") || "genesis only"

  return (
    <div className="widget-meta-grid">
      <MetricCell
        label="Inscription"
        value={`#${meta.inscription_number?.toLocaleString() ?? "—"}`}
      />
      <MetricCell
        label="Sat"
        value={meta.sat?.toLocaleString("en-US") ?? "—"}
        badge={<SatBadge rarity={meta.sat_rarity} />}
      />
      <MetricCell
        label="Genesis Block"
        value={meta.genesis_block?.toLocaleString() ?? "—"}
        sub={genesisDate}
      />
      <MetricCell
        label="Content Type"
        value={meta.content_type}
      />
      <MetricCell
        label="Events"
        value={`${eventCount} total`}
        sub={eventSummary}
      />
      <MetricCell
        label="Current Owner"
        value={truncateAddress(meta.owner_address)}
        actions={
          <div className="widget-meta-actions">
            <button
              className="widget-action-btn"
              title="Copy address"
              onClick={() => navigator.clipboard.writeText(meta.owner_address)}
            >
              📋
            </button>
            <a
              className="widget-action-btn"
              href={`https://mempool.space/address/${meta.owner_address}`}
              target="_blank"
              rel="noopener noreferrer"
              title="View on mempool.space"
            >
              🔗
            </a>
          </div>
        }
      />
    </div>
  )
}

// --- Internal components ---

function MetricCell({
  label,
  value,
  sub,
  badge,
  actions,
}: {
  label: string
  value: string
  sub?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="widget-meta-cell">
      <span className="widget-meta-label">{label}</span>
      <span className="widget-meta-value">{value}</span>
      {badge}
      {sub && <span className="widget-meta-sub">{sub}</span>}
      {actions}
    </div>
  )
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 16) return addr || "—"
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}
