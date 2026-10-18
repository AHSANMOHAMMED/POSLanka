-- Add image_size column to items table for file storage tracking
-- Item images bypass the files table, so we track their size here
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_size INTEGER;
