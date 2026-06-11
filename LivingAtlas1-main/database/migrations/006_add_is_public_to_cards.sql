-- Migration 006: Add is_public column to Cards table
-- is_public = TRUE means visible to all users (default)
-- is_public = FALSE means only visible to the uploader
ALTER TABLE Cards ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
