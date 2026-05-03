// OG Tier Engine — calculates contribution weight based on Discord identity.
// Tier determines moderation level for wiki contributions (Pilar 2).
//
// Tiers (ascending trust):
//   anon      → no Discord (score 0.3) — should not reach this in OAuth callback
//   community → Discord connected, any recognized server (score 0.6)
//   og        → account > 1yr + OG server membership (score 0.85)
//   genesis   → manual whitelist in KV (score 1.0)

import type { OGTier } from "./jwt"

export const TIER_SCORES: Record<OGTier, number> = {
  anon: 0.3,
  community: 0.6,
  og: 0.85,
  genesis: 1.0,
}

interface ServerConfig {
  og_servers: string[]
  community_servers: string[]
}

const OG_ACCOUNT_AGE_MS = 365 * 24 * 60 * 60 * 1000 // 1 year

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  og_servers: [],      // configured via KV: og_server_config
  community_servers: [], // configured via KV: og_server_config
}

/**
 * Read server config from KV. Falls back to empty lists on error.
 * Config stored as JSON at key `og_server_config`.
 */
async function getServerConfig(kv: KVNamespace): Promise<ServerConfig> {
  try {
    const raw = await kv.get("og_server_config")
    if (!raw) return DEFAULT_SERVER_CONFIG
    const parsed = JSON.parse(raw) as Partial<ServerConfig>
    return {
      og_servers: Array.isArray(parsed.og_servers) ? parsed.og_servers : [],
      community_servers: Array.isArray(parsed.community_servers) ? parsed.community_servers : [],
    }
  } catch {
    return DEFAULT_SERVER_CONFIG
  }
}

/**
 * Check if discord_id is in the genesis whitelist (KV key `og_genesis_whitelist`).
 * Whitelist is stored as JSON array of discord_id strings.
 */
async function isGenesisWhitelisted(discordId: string, kv: KVNamespace): Promise<boolean> {
  try {
    const raw = await kv.get("og_genesis_whitelist")
    if (!raw) return false
    const list = JSON.parse(raw) as string[]
    return Array.isArray(list) && list.includes(discordId)
  } catch {
    return false
  }
}

/**
 * Calculate the OG tier for a Discord user.
 *
 * @param discordId    The user's Discord snowflake ID
 * @param guildIds     Array of guild IDs the user belongs to (from /users/@me/guilds)
 * @param accountCreatedAt Date the Discord account was created (derived from snowflake)
 * @param kv           KV namespace to read config and whitelist
 */
export async function calculateTier(
  discordId: string,
  guildIds: string[],
  accountCreatedAt: Date,
  kv: KVNamespace
): Promise<OGTier> {
  // 1. Genesis whitelist takes priority
  const isGenesis = await isGenesisWhitelisted(discordId, kv)
  if (isGenesis) return "genesis"

  // 2. Load server config
  const config = await getServerConfig(kv)

  const guildSet = new Set(guildIds)

  // 3. OG: account older than 1yr + member of an OG server
  const accountAgeMs = Date.now() - accountCreatedAt.getTime()
  const isOldAccount = accountAgeMs >= OG_ACCOUNT_AGE_MS
  const isOgServer = config.og_servers.some((id) => guildSet.has(id))

  if (isOldAccount && isOgServer) return "og"

  // 4. Community: member of any recognized server (OG or community)
  const allRecognizedServers = [...config.og_servers, ...config.community_servers]
  const isRecognizedServer = allRecognizedServers.some((id) => guildSet.has(id))

  if (isRecognizedServer) return "community"

  // 5. Fallback: Discord connected but no recognized server
  return "community"
}
