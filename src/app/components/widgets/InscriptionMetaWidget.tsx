import type { InscriptionMeta, ChronicleEvent } from "../../lib/types"
import { formatContentTypeLabel } from "../../lib/media"
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

  return (
    <div className="widget-meta-grid">
      <MetricCell
        label="Inscription"
        value={`#${meta.inscription_number?.toLocaleString() ?? "—"}`}
        href={`https://ordinals.com/inscription/${meta.inscription_id}`}
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
        href={`https://mempool.space/block/${meta.genesis_block}`}
        subHref={`https://mempool.space/tx/${meta.genesis_txid}`}
      />
      <MetricCell
        label="Content Type"
        value={formatContentTypeLabel(meta.content_type)}
        sub={meta.content_type}
        href={`https://ordinals.com/content/${meta.inscription_id}`}
      />
      <MetricCell
        label="Events"
        value={`${eventCount} total`}
      />
      <MetricCell
        label="Current Owner"
        value={truncateAddress(meta.owner_address)}
        href={`https://mempool.space/address/${meta.owner_address}`}
        copyValue={meta.owner_address}
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
  href,
  subHref,
  copyValue,
}: {
  label: string
  value: string
  sub?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  href?: string
  subHref?: string
  copyValue?: string
}) {
  return (
    <div className="widget-meta-cell">
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
        <span className="widget-meta-label" style={{ marginBottom: 0 }}>{label}</span>
        {badge}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span className="widget-meta-value">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="brand-link" style={{ color: "inherit" }}>
              {value}
            </a>
          ) : (
            value
          )}
        </span>
        {copyValue && (
          <button
            className="widget-action-btn-mini"
            onClick={() => navigator.clipboard.writeText(copyValue)}
            title="Copy"
            style={{ 
              background: "none", 
              border: "none", 
              padding: 0, 
              cursor: "pointer", 
              fontSize: "0.75rem",
              opacity: 0.5,
              display: "inline-flex",
              alignItems: "center"
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        )}
      </div>
      {sub && (
        <span className="widget-meta-sub">
          {subHref ? (
            <a href={subHref} target="_blank" rel="noopener noreferrer" className="brand-link" style={{ color: "inherit", textDecoration: "none" }}>
              {sub}
            </a>
          ) : (
            sub
          )}
        </span>
      )}
      {actions}
    </div>
  )
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 16) return addr || "—"
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}
