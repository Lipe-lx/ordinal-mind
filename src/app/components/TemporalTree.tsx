import { motion } from "motion/react"
import type { ChronicleEvent } from "../lib/types"
import { linkifyBrands } from "../lib/brandLinks"

interface Props {
  events: ChronicleEvent[]
  collectionSlug?: string
}

const EVENT_ICONS: Record<string, string> = {
  genesis: "⛏️",
  transfer: "↗️",
  sale: "💰",
  social_mention: "✦",
  collection_link: "📂",
  recursive_ref: "🔗",
  sat_context: "💎",
  trait_context: "🧬",
}

const EVENT_LABELS: Record<string, string> = {
  genesis: "Genesis",
  transfer: "Transfer",
  sale: "Sale",
  social_mention: "Social Mention",
  collection_link: "Collection",
  recursive_ref: "Recursive Ref",
  sat_context: "Sat Rarity",
  trait_context: "Trait Context",
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (d.getTime() === 0) return "Unknown date"
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function sourceUrl(source: ChronicleEvent["source"]): string | null {
  if (source.type === "web") return source.ref
  if (source.ref.startsWith("block:")) return null
  if (source.ref.startsWith("sat:")) return null
  // Assume it's a txid
  return `https://mempool.space/tx/${source.ref}`
}

/**
 * Formats a sale price from sats to a readable BTC string.
 */
function formatBtcPrice(sats: number): string {
  const btc = sats / 1e8
  if (btc >= 0.01) return `${btc.toFixed(4)} BTC`
  if (btc >= 0.0001) return `${btc.toFixed(6)} BTC`
  return `${sats.toLocaleString("en-US")} sats`
}

export function TemporalTree({ events, collectionSlug }: Props) {
  const hasTransfers = events.some(
    (e) => e.event_type === "transfer" || e.event_type === "sale"
  )

  return (
    <div className="temporal-tree">
      {events.map((event, index) => {
        const url = sourceUrl(event.source)
        const isHeuristic = event.metadata?.is_heuristic === true
        const salePriceSats = event.metadata?.sale_price_sats as number | undefined
        const platform = typeof event.metadata?.platform === "string" ? event.metadata.platform : undefined
        const scope = typeof event.metadata?.scope === "string" ? event.metadata.scope : undefined

        return (
          <motion.div
            key={event.id}
            className="timeline-node"
            data-type={event.event_type}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.4,
              delay: index * 0.06,
              ease: [0.4, 0, 0.2, 1],
            }}
            whileHover={{
              scale: 1.01,
              transition: { duration: 0.15 },
            }}
          >
            <div className="timeline-node-header">
              <span className="timeline-node-type">
                {event.event_type === "social_mention"
                  ? socialIcon(platform)
                  : EVENT_ICONS[event.event_type] ?? "•"}{" "}
                {event.event_type === "social_mention"
                  ? socialLabel(platform)
                  : linkifyBrands(EVENT_LABELS[event.event_type] ?? event.event_type, collectionSlug)}
              </span>
              <span className="timeline-node-time">
                {formatDate(event.timestamp)}
              </span>
            </div>

            <p className="timeline-node-desc">
              {linkifyBrands(event.description, collectionSlug)}
              {event.event_type === "social_mention" && scope && (
                <span
                  className="timeline-node-heuristic"
                  title={scope === "collection_level"
                    ? "This signal matched the collection name more strongly than the specific inscription."
                    : scope === "mixed"
                      ? "This signal references both the collection and the inscription label."
                      : "This signal matched inscription-level labels directly."}
                >
                  {scope === "collection_level"
                    ? "collection-level"
                    : scope === "mixed"
                      ? "mixed-scope"
                      : "inscription-level"}
                </span>
              )}
              {event.event_type === "sale" && isHeuristic && (
                <span
                  className="timeline-node-heuristic"
                  title="Price detected via on-chain heuristic analysis of PSBT transaction structure. Verify on mempool.space for exact details."
                >
                  estimated
                </span>
              )}
            </p>

            {/* Sale price highlight */}
            {event.event_type === "sale" && salePriceSats != null && (
              <div className="timeline-node-price">
                {formatBtcPrice(salePriceSats)}
              </div>
            )}

            {url && (
              <div className="timeline-node-source">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {event.source.type === "onchain"
                    ? "View on mempool.space ↗"
                    : "View source ↗"}
                </a>
              </div>
            )}
          </motion.div>
        )
      })}

      {/* FIFO Disclosure — shown when transfer/sale events exist */}
      {hasTransfers && (
        <motion.div
          className="timeline-disclaimer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: events.length * 0.06 + 0.2, duration: 0.4 }}
        >
          <span className="timeline-disclaimer-icon">ℹ️</span>
          <span>
            Transfer tracking uses simplified ordinal theory (FIFO vout 0).
            Sale prices are estimated via on-chain heuristics.{" "}
            <a
              href="https://docs.ordinals.com/overview.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more ↗
            </a>
          </span>
        </motion.div>
      )}
    </div>
  )
}

function socialLabel(platform: string | undefined): string {
  switch (platform) {
    case "x":
      return "X Mention"
    case "google_trends":
      return "Google Trends"
    default:
      return "Social Mention"
  }
}

function socialIcon(platform: string | undefined): string {
  switch (platform) {
    case "x":
      return "𝕏"
    case "google_trends":
      return "📈"
    default:
      return "✦"
  }
}
