import type { SatRarity } from "../lib/types"

interface Props {
  rarity: SatRarity
}

export function SatBadge({ rarity }: Props) {
  return (
    <span className={`sat-badge sat-badge--${rarity}`}>
      {rarity === "mythic" ? "✦ " : ""}
      {rarity}
    </span>
  )
}
