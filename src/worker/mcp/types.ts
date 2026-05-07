import type { OGTier } from "../auth/jwt"

export interface McpAuthProps {
  sub: string
  username: string
  avatar: string | null
  tier: OGTier
  scopes: string[]
  capabilities: string[]
  auth_source: "discord_oauth"
}

export interface McpResolvedAuth {
  props: McpAuthProps
}

export interface ToolCapabilityMap {
  canContributeWiki: boolean
  canReviewContribution: boolean
  canRefreshChronicle: boolean
  canReindexCollection: boolean
}

export function toCapabilityMap(tier: OGTier | undefined): ToolCapabilityMap {
  return {
    canContributeWiki: tier === "community" || tier === "og" || tier === "genesis",
    canReviewContribution: tier === "genesis",
    canRefreshChronicle: tier === "genesis",
    canReindexCollection: tier === "genesis",
  }
}

export function normalizeTier(value: unknown): OGTier | undefined {
  if (value === "anon" || value === "community" || value === "og" || value === "genesis") {
    return value
  }
  return undefined
}
