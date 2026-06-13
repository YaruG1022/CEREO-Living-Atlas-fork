-- Migration 007: Add RingIndex column to CardPolygonVertices
-- This supports storing multiple separate polygons (rings) per card (MultiPolygon).
-- RingIndex = 0 means first (or only) polygon; higher values = additional polygons.
ALTER TABLE CardPolygonVertices
  ADD COLUMN IF NOT EXISTS RingIndex INT NOT NULL DEFAULT 0;
