-- W3 stock intake: staging batches + lines, synced into stock through the ledger.

DO $$ BEGIN
  CREATE TYPE "stock_intake_status" AS ENUM ('draft', 'submitted', 'syncing', 'posted', 'partially_posted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "stock_intake_line_status" AS ENUM ('pending', 'posted', 'error', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "stock_intake_line_mode" AS ENUM ('receive', 'count');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_intake_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "batch_no" varchar(40) NOT NULL,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "status" "stock_intake_status" NOT NULL DEFAULT 'draft',
  "source" varchar(20) NOT NULL DEFAULT 'web',
  "client_batch_id" uuid,
  "notes" text,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "update_cost" boolean NOT NULL DEFAULT false,
  "total_lines" integer NOT NULL DEFAULT 0,
  "posted_lines" integer NOT NULL DEFAULT 0,
  "error_lines" integer NOT NULL DEFAULT 0,
  "last_sync_key" varchar(100),
  "last_sync_result" jsonb,
  "sync_started_at" timestamp,
  "sync_attempts" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" timestamp,
  "posted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "posted_at" timestamp,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_intake_batches_tenant_batch_no_unique"
  ON "stock_intake_batches" ("tenant_id", "batch_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_intake_batches_tenant_client_unique"
  ON "stock_intake_batches" ("tenant_id", "client_batch_id") WHERE "client_batch_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stock_intake_batches_tenant_status"
  ON "stock_intake_batches" ("tenant_id", "status", "created_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_intake_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "batch_id" uuid NOT NULL REFERENCES "stock_intake_batches"("id") ON DELETE CASCADE,
  "client_line_id" uuid,
  -- client line ids that were merged into this line (receive) or replaced it (count): replays stay idempotent
  "merged_client_line_ids" uuid[] NOT NULL DEFAULT '{}',
  "line_mode" "stock_intake_line_mode" NOT NULL DEFAULT 'receive',
  "barcode" varchar(100),
  "sku" varchar(100),
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "quantity" numeric(12,3) NOT NULL CONSTRAINT "stock_intake_lines_quantity_nonneg" CHECK ("quantity" >= 0),
  "system_qty_snapshot" numeric(12,3),
  "name" varchar(255),
  "category_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL,
  "unit" varchar(50),
  "cost_price" numeric(12,2),
  "selling_price" numeric(12,2),
  "match_type" varchar(20),
  "status" "stock_intake_line_status" NOT NULL DEFAULT 'pending',
  "error_message" text,
  "result_item_id" uuid,
  "result_movement_id" uuid,
  "created_item" boolean NOT NULL DEFAULT false,
  "posted_at" timestamp,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_intake_lines_batch_client_unique"
  ON "stock_intake_lines" ("batch_id", "client_line_id") WHERE "client_line_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stock_intake_lines_tenant_batch_status"
  ON "stock_intake_lines" ("tenant_id", "batch_id", "status");
--> statement-breakpoint

-- Row Level Security
ALTER TABLE "stock_intake_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_intake_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_intake_batches' AND policyname = 'stock_intake_batches_tenant_isolation'
  ) THEN
    CREATE POLICY "stock_intake_batches_tenant_isolation" ON "stock_intake_batches"
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stock_intake_lines' AND policyname = 'stock_intake_lines_tenant_isolation'
  ) THEN
    CREATE POLICY "stock_intake_lines_tenant_isolation" ON "stock_intake_lines"
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
--> statement-breakpoint

-- Grant permissions to app_user role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_intake_batches" TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_intake_lines" TO app_user;
  END IF;
END $$;
