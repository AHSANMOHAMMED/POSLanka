-- Add 'import' to activity_action enum
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'import';
