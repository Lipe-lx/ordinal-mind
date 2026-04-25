// Sat rarity and charm icon badges — designed for overlay on inscription preview.
// Each rarity tier has a distinct SVG icon with tier-specific effects.
// Charms display as smaller inline badges with emoji icons.

import type { SatRarity } from "../lib/types"

// --- Rarity icon mapping ---

const RARITY_CONFIG: Record<SatRarity, {
  icon: string
  label: string
  show: boolean  // common is hidden by default
}> = {
  common: { icon: "●", label: "Common", show: false },
  uncommon: { icon: "◆", label: "Uncommon", show: true },
  rare: { icon: "★", label: "Rare", show: true },
  epic: { icon: "⚡", label: "Epic", show: true },
  legendary: { icon: "🔥", label: "Legendary", show: true },
  mythic: { icon: "✦", label: "Mythic", show: true },
}

// --- Charm icon mapping ---

const CHARM_ICONS: Record<string, string> = {
  vintage: "🏺",
  cursed: "☠️",
  nineball: "🎱",
  reinscription: "↻",
  uncommon: "◆",
  coin: "🪙",
  lost: "👻",
  unbound: "⛓️",
  vindicated: "⚖️",
  burned: "💀",
  epic: "⚡",
  rare: "★",
  legendary: "🔥",
  mythic: "✦",
}

// --- Components ---

interface SatRarityBadgeProps {
  rarity: SatRarity
}

export function SatRarityBadge({ rarity }: SatRarityBadgeProps) {
  const config = RARITY_CONFIG[rarity]
  if (!config.show) return null

  return (
    <span
      className={`sat-rarity-icon sat-rarity-icon--${rarity}`}
      title={`Sat rarity: ${config.label}`}
    >
      <span className="sat-rarity-icon-symbol">{config.icon}</span>
      <span className="sat-rarity-icon-label">{config.label}</span>
    </span>
  )
}

interface CharmBadgeProps {
  charm: string
}

export function CharmBadge({ charm }: CharmBadgeProps) {
  // Don't show charms that are already covered by the rarity badge
  const rarityCharms = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]
  if (rarityCharms.includes(charm.toLowerCase())) return null

  const icon = CHARM_ICONS[charm.toLowerCase()] ?? "✧"

  return (
    <span
      className="charm-badge"
      title={`Charm: ${charm}`}
    >
      <span className="charm-badge-icon">{icon}</span>
      <span className="charm-badge-label">{charm}</span>
    </span>
  )
}

// Legacy inline badge (kept for backward compatibility in metadata widget)
interface LegacyProps {
  rarity: SatRarity
}

export function SatBadge({ rarity }: LegacyProps) {
  return (
    <span className={`sat-badge sat-badge--${rarity}`}>
      {rarity === "mythic" ? "✦ " : ""}
      {rarity}
    </span>
  )
}
