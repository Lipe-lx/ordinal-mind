CREATE TABLE IF NOT EXISTS wiki_pages (
  slug                  TEXT PRIMARY KEY,
  entity_type           TEXT NOT NULL,
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  sections_json         TEXT NOT NULL DEFAULT '[]',
  cross_refs_json       TEXT NOT NULL DEFAULT '[]',
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  generated_at          TEXT NOT NULL,
  byok_provider         TEXT NOT NULL,
  unverified_count      INTEGER NOT NULL DEFAULT 0,
  view_count            INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,
  slug        TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ts          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wp_entity_type ON wiki_pages(entity_type);
CREATE INDEX IF NOT EXISTS idx_wp_generated ON wiki_pages(generated_at);
CREATE INDEX IF NOT EXISTS idx_wp_unverified ON wiki_pages(unverified_count);
CREATE INDEX IF NOT EXISTS idx_wl_ts ON wiki_log(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
  slug UNINDEXED,
  entity_type,
  title,
  summary,
  content='wiki_pages',
  content_rowid='rowid',
  tokenize='porter ascii'
);

CREATE TRIGGER IF NOT EXISTS wiki_fts_insert AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO wiki_fts(rowid, slug, entity_type, title, summary)
  VALUES (new.rowid, new.slug, new.entity_type, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS wiki_fts_update AFTER UPDATE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, slug, entity_type, title, summary)
  VALUES ('delete', old.rowid, old.slug, old.entity_type, old.title, old.summary);
  INSERT INTO wiki_fts(rowid, slug, entity_type, title, summary)
  VALUES (new.rowid, new.slug, new.entity_type, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS wiki_fts_delete AFTER DELETE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, slug, entity_type, title, summary)
  VALUES ('delete', old.rowid, old.slug, old.entity_type, old.title, old.summary);
END;
