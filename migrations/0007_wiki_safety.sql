-- Migration: 0007_wiki_safety.sql
-- Adds safety tracking for wiki contributions.

ALTER TABLE wiki_contributions ADD COLUMN safety_status TEXT NOT NULL DEFAULT 'safe'; -- safe | flagged | rejected
ALTER TABLE wiki_contributions ADD COLUMN safety_metadata TEXT; -- JSON metadata from the safety agent
