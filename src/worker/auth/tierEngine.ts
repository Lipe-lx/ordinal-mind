// OG Tier Engine — calculates contribution weight based on Discord identity.
// Tier determines moderation level for wiki contributions (Pilar 2).
//
// Tiers (ascending trust):
//   anon      → no Discord (score 0.3) — should not reach this in OAuth callback
//   community → Discord connected, any recognized server (score 0.6)
//   og        → account > 1yr + OG server membership (score 0.85)
//   genesis   → manual whitelist in KV (score 1.0)

import type { OGTier, DiscordBadge } from "./jwt"
import type { DiscordGuild } from "./discord"

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

const FALLBACK_GENESIS_IDS = new Set([
  "747550957432471654", // lipe.lx
])

// Curated lists with importance levels
const VERY_IMPORTANT_IDS = [
  "987504378242007100",
  "1069807785283428373",
  "1072872589778755644",
  "1131000554005467206"
]

const IMPORTANT_IDS = [
  "1298700658769268817",
  "1090331629827924020",
  "1321689786116866048",
  "1189000124215599164",
  "1069763617861423195",
  "1072557304668487771",
  "891779082063319122"
]

const VERIFIED_SERVER_IDS = [
  ...VERY_IMPORTANT_IDS,
  ...IMPORTANT_IDS,
  "1304975015942422568",
  "1375176106096984154",
  "1343702732837748747",
  "1099100624597033123",
  "1349373889972539403",
  "1116728354234695771",
  "1228725022437277819",
  "1072650133851869204",
  "1115735125494341762",
  "1088742892354408518",
  "1121957212181508146",
  "988901741640687717",
  "1241112027963986001"
]

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
  if (FALLBACK_GENESIS_IDS.has(discordId)) return true
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

/**
 * Calculate badges based on membership in curated servers.
 * Uses the name of the guild directly from Discord.
 */
export async function calculateBadges(
  guilds: DiscordGuild[],
  _kv: KVNamespace
): Promise<DiscordBadge[]> {
  const verifiedSet = new Set(VERIFIED_SERVER_IDS)
  const level2Set = new Set(VERY_IMPORTANT_IDS)
  const level1Set = new Set(IMPORTANT_IDS)
  
  const badgesMap = new Map<string, DiscordBadge>()

  for (const guild of guilds) {
    if (verifiedSet.has(guild.id)) {
      let level = 0
      if (level2Set.has(guild.id)) level = 2
      else if (level1Set.has(guild.id)) level = 1
      
      badgesMap.set(guild.id, { name: guild.name, level })
    }
  }

  // Deduplicate by ID and return sorted by level (desc)
  return Array.from(badgesMap.values()).sort((a, b) => b.level - a.level)
}
