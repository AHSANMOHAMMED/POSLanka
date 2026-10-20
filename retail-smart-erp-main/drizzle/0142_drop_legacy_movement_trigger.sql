-- C3: every stock writer now goes through applyStockChange (src/lib/inventory/apply-stock-change.ts),
-- which always sets qty_change / stock_before / stock_after. Drop the transitional
-- trigger from 0128 that derived qty_change for legacy direct inserts: a writer that
-- omits qty_change now fails loudly on the NOT NULL constraint instead of being patched.
DROP TRIGGER IF EXISTS stock_movements_legacy_fill ON stock_movements;
--> statement-breakpoint
DROP FUNCTION IF EXISTS stock_movements_legacy_fill();
