-- Migration: 0008_wiki_public_author.sql
-- Adds optional public attribution metadata for wiki contributions while
-- preserving private contributor_id for moderation and future user history.

ALTER TABLE wiki_contributions ADD COLUMN public_author_mode TEXT NOT NULL DEFAULT 'anonymous';
ALTER TABLE wiki_contributions ADD COLUMN public_author_username TEXT;
ALTER TABLE wiki_contributions ADD COLUMN public_author_avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_wc_collection_contributor_created_at
ON wiki_contributions(collection_slug, contributor_id, created_at DESC);
