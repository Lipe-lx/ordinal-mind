import type { InscriptionMeta } from "../../lib/types"

interface Props {
  meta: InscriptionMeta
}

export function FactualInfoWidget({ meta }: Props) {
  const formatDate = (iso: string) => {
    const d = new Date(iso)
    if (d.getTime() === 0) return "—"
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatBtc = (sats: number) => {
    return (sats / 1e8).toFixed(5) + " BTC"
  }

  return (
    <div className="glass-card" style={{ padding: "var(--space-md)" }}>
      <div className="widget-meta-grid">
      <MetricCell label="Mint Date" value={formatDate(meta.genesis_timestamp)} />
      <MetricCell 
        label="Genesis Fee" 
        value={formatBtc(meta.genesis_fee)} 
        href={`https://mempool.space/tx/${meta.genesis_txid}`}
      />
      <MetricCell 
        label="Genesis Owner" 
        value={truncateAddress(meta.genesis_owner_address ?? "")} 
        href={meta.genesis_owner_address ? `https://mempool.space/address/${meta.genesis_owner_address}` : undefined}
      />
      <MetricCell 
        label="Genesis Block" 
        value={`#${meta.genesis_block?.toLocaleString()}`} 
        href={`https://mempool.space/block/${meta.genesis_block}`}
      />
      </div>
    </div>
  )
}

function MetricCell({ label, value, href }: { label: string, value: string, href?: string }) {
  return (
    <div className="widget-meta-cell">
      <span className="widget-meta-label">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="widget-meta-value" style={{ color: "var(--accent-primary)" }}>
          {value}
        </a>
      ) : (
        <span className="widget-meta-value">{value}</span>
      )}
    </div>
  )
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 16) return addr || "—"
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}


