import type { Env } from "../index"

interface TableInfoRow {
  name: string
}

export interface ContributionColumnCaps {
  hasValueNorm: boolean
  hasContributorKey: boolean
  hasUpdatedAt: boolean
  hasSafetyStatus: boolean
  hasSafetyMetadata: boolean
  hasPublicAuthorMode: boolean
  hasPublicAuthorUsername: boolean
  hasPublicAuthorAvatarUrl: boolean
}

export async function getContributionColumnCaps(env: Env): Promise<ContributionColumnCaps> {
  if (!env.DB) {
    return emptyContributionColumnCaps()
  }

  try {
    const columns = await env.DB.prepare("PRAGMA table_info('wiki_contributions')")
      .all<TableInfoRow>()
    const names = new Set((columns.results ?? []).map((row) => row.name))
    return {
      hasValueNorm: names.has("value_norm"),
      hasContributorKey: names.has("contributor_key"),
      hasUpdatedAt: names.has("updated_at"),
      hasSafetyStatus: names.has("safety_status"),
      hasSafetyMetadata: names.has("safety_metadata"),
      hasPublicAuthorMode: names.has("public_author_mode"),
      hasPublicAuthorUsername: names.has("public_author_username"),
      hasPublicAuthorAvatarUrl: names.has("public_author_avatar_url"),
    }
  } catch {
    return emptyContributionColumnCaps()
  }
}

function emptyContributionColumnCaps(): ContributionColumnCaps {
  return {
    hasValueNorm: false,
    hasContributorKey: false,
    hasUpdatedAt: false,
    hasSafetyStatus: false,
    hasSafetyMetadata: false,
    hasPublicAuthorMode: false,
    hasPublicAuthorUsername: false,
    hasPublicAuthorAvatarUrl: false,
  }
}
