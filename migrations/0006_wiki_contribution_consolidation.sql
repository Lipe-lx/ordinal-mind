-- Migration: 0006_wiki_contribution_consolidation.sql
-- Consolidates active wiki contributions by contributor + slug + field,
-- adds normalized value support, and preserves auditability.

ALTER TABLE wiki_contributions ADD COLUMN value_norm TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki_contributions ADD COLUMN contributor_key TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki_contributions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE wiki_contributions
SET contributor_key = CASE
  WHEN contributor_id IS NOT NULL AND length(trim(contributor_id)) > 0 THEN 'user:' || trim(contributor_id)
  ELSE 'anon:' || trim(session_id)
END
WHERE contributor_key = '' OR contributor_key IS NULL;

UPDATE wiki_contributions
SET value_norm = lower(trim(value))
WHERE value_norm = '' OR value_norm IS NULL;

UPDATE wiki_contributions
SET updated_at = CASE
  WHEN reviewed_at IS NOT NULL AND reviewed_at != '' THEN reviewed_at
  WHEN created_at IS NOT NULL AND created_at != '' THEN created_at
  ELSE datetime('now')
END
WHERE updated_at = '' OR updated_at IS NULL;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY collection_slug, field, contributor_key, status
      ORDER BY datetime(created_at) DESC, id DESC
    ) AS row_rank
  FROM wiki_contributions
  WHERE status IN ('published', 'quarantine')
)
UPDATE wiki_contributions
SET
  status = 'duplicate',
  reviewed_at = COALESCE(reviewed_at, datetime('now')),
  updated_at = datetime('now')
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_rank > 1
);

CREATE INDEX IF NOT EXISTS idx_wc_contributor_key ON wiki_contributions(contributor_key);
CREATE INDEX IF NOT EXISTS idx_wc_updated_at ON wiki_contributions(updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_active_unique_published
ON wiki_contributions(collection_slug, field, contributor_key)
WHERE status = 'published';

CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_active_unique_quarantine
ON wiki_contributions(collection_slug, field, contributor_key)
WHERE status = 'quarantine';
