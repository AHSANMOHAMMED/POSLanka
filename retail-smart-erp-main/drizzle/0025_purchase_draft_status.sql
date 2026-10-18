-- Migration: Add 'draft' status to purchase_status enum
-- This enables the ERPNext-style document lifecycle:
-- Draft (editable) → Submit → Pending (record payment) → Partial → Paid

ALTER TYPE "purchase_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'pending';
