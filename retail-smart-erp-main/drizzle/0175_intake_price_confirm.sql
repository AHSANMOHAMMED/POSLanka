-- Stock intake: a scanned selling price that differs from the item's is only applied after the
-- user confirms it ('apply'); 'keep' or no decision leaves the item's price untouched. Idempotent.
ALTER TABLE stock_intake_lines ADD COLUMN IF NOT EXISTS price_decision varchar(10);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE stock_intake_lines ADD CONSTRAINT stock_intake_lines_price_decision_check CHECK (price_decision IS NULL OR price_decision IN ('apply', 'keep'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
