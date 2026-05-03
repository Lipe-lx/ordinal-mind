-- Migration 0003: Discord identity table
-- Part of Pilar 1 — OrdinalMind Wiki Identity system

CREATE TABLE IF NOT EXISTS users (
  discord_id       TEXT PRIMARY KEY,
  username         TEXT NOT NULL,
  avatar_hash      TEXT,
  og_tier          TEXT NOT NULL DEFAULT 'community',
  server_ids_json  TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(og_tier);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
