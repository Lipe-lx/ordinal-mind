// One-time storage key migration from "ordinal-mind" / "ordinal_mind" prefix
// to "ordinalmind" prefix. Runs synchronously on app boot. Safe to call
// multiple times — skips keys that don't exist.

const MIGRATION_PAIRS: Array<[string, string]> = [
  // localStorage keys
  ["ordinal-mind_byok_encrypted", "ordinalmind_byok_encrypted"],
  ["ordinal-mind_discord_jwt", "ordinalmind_discord_jwt"],
  ["ordinal-mind_discord_connected", "ordinalmind_discord_connected"],
  ["ordinal-mind_device_key", "ordinalmind_device_key"],
  ["ordinal-mind_intent_router_mode", "ordinalmind_intent_router_mode"],
]

const SESSION_MIGRATION_PAIRS: Array<[string, string]> = [
  // sessionStorage keys
  ["ordinal-mind_byok_config", "ordinalmind_byok_config"],
  ["ordinal-mind_narrative_chat_threads_v2", "ordinalmind_narrative_chat_threads_v2"],
  ["ordinal-mind_narrative_chat_threads_v1", "ordinalmind_narrative_chat_threads_v1"],
]

function migrateStorage(storage: Storage, pairs: Array<[string, string]>): void {
  for (const [oldKey, newKey] of pairs) {
    try {
      const value = storage.getItem(oldKey)
      if (value !== null && storage.getItem(newKey) === null) {
        storage.setItem(newKey, value)
        storage.removeItem(oldKey)
      } else if (value !== null) {
        // New key already exists, just clean up old
        storage.removeItem(oldKey)
      }
    } catch {
      // Non-blocking — storage access can throw in restricted contexts
    }
  }
}

/**
 * Migrate legacy "ordinal-mind" prefixed storage keys to "ordinalmind".
 * Called once at app boot. Idempotent and non-blocking.
 */
export function runStorageMigration(): void {
  try {
    migrateStorage(localStorage, MIGRATION_PAIRS)
    migrateStorage(sessionStorage, SESSION_MIGRATION_PAIRS)

    // Also migrate keys with colon separator pattern
    const colonPairs: Array<[string, string]> = [
      ["ordinal-mind:wiki-lint-checked", "ordinalmind:wiki-lint-checked"],
      ["ordinal-mind:wiki-lint-report", "ordinalmind:wiki-lint-report"],
      ["ordinal-mind:auth-sync", "ordinalmind:auth-sync"],
    ]
    migrateStorage(sessionStorage, colonPairs)
    migrateStorage(localStorage, colonPairs)
  } catch {
    // Storage completely unavailable — skip silently
  }
}
