-- Migration 008: Add per-ring style columns to CardPolygonVertices.
-- Style is stored per-vertex (duplicated within each ring) for backward compatibility
-- and simple query logic.
ALTER TABLE CardPolygonVertices
  ADD COLUMN IF NOT EXISTS FillColor VARCHAR(20),
  ADD COLUMN IF NOT EXISTS FillOpacity DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS LineStyle VARCHAR(20);

-- Backfill existing rows so old polygons keep visible default styles.
UPDATE CardPolygonVertices
SET
  FillColor = COALESCE(FillColor, '#0077c0'),
  FillOpacity = COALESCE(FillOpacity, 0.2),
  LineStyle = COALESCE(LineStyle, 'solid');
