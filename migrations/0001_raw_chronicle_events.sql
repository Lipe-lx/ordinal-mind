CREATE TABLE IF NOT EXISTS raw_chronicle_events (
  id             TEXT PRIMARY KEY,
  inscription_id TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  timestamp      TEXT,
  block_height   INTEGER,
  source_type    TEXT NOT NULL,
  source_ref     TEXT NOT NULL,
  description    TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rce_inscription ON raw_chronicle_events(inscription_id);
CREATE INDEX IF NOT EXISTS idx_rce_event_type ON raw_chronicle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rce_timestamp ON raw_chronicle_events(timestamp);
