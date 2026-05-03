-- Migration: 0004_wiki_contributions.sql
-- Pillar 2 — Chat Wiki Builder
-- Stores structured knowledge contributions extracted from chat sessions.
-- Status flow: quarantine → published (via moderation / tier auto-publish)
-- Tier rules:
--   anon/community → status = 'quarantine'
--   og/genesis     → status = 'published'

CREATE TABLE IF NOT EXISTS wiki_contributions (
  id                TEXT PRIMARY KEY,
  collection_slug   TEXT NOT NULL,
  field             TEXT NOT NULL,
  value             TEXT NOT NULL,
  confidence        TEXT NOT NULL DEFAULT 'stated_by_user',
  verifiable        INTEGER NOT NULL DEFAULT 0,
  contributor_id    TEXT,          -- discord_id or NULL for anon
  og_tier           TEXT NOT NULL DEFAULT 'anon',
  session_id        TEXT NOT NULL,
  source_excerpt    TEXT,          -- the chat excerpt that originated this
  status            TEXT NOT NULL DEFAULT 'quarantine',  -- quarantine | published | duplicate
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at       TEXT           -- NULL until reviewed
);

CREATE INDEX IF NOT EXISTS idx_wc_collection ON wiki_contributions(collection_slug);
CREATE INDEX IF NOT EXISTS idx_wc_field      ON wiki_contributions(field);
CREATE INDEX IF NOT EXISTS idx_wc_status     ON wiki_contributions(status);
CREATE INDEX IF NOT EXISTS idx_wc_tier       ON wiki_contributions(og_tier);
CREATE INDEX IF NOT EXISTS idx_wc_contributor ON wiki_contributions(contributor_id);
