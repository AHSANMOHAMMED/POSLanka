-- W3 stock intake: new cost_change_source values.
-- Kept in its own file: a value added by ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction that added it.
ALTER TYPE "cost_change_source" ADD VALUE IF NOT EXISTS 'stock_intake';
--> statement-breakpoint
ALTER TYPE "cost_change_source" ADD VALUE IF NOT EXISTS 'import';
