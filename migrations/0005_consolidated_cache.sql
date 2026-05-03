-- Migration: 0005_consolidated_cache.sql
-- Pillar 3 — Canonical Consolidation and Wiki UI
-- Stores a materialized cache of the computationally heavy consensus engine.
-- Rebuilt lazily via GET /consolidated or invalidated on new OG/Genesis contributions.

CREATE TABLE IF NOT EXISTS consolidated_cache (
  collection_slug   TEXT PRIMARY KEY,
  snapshot_json     TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0,
  completeness      REAL NOT NULL DEFAULT 0,
  contribution_count INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
