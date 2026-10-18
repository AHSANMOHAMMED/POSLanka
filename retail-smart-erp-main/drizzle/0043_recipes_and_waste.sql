-- Migration: Add recipes, recipe_ingredients, and waste_log tables
-- Supports recipe/BOM system for restaurant and food cost tracking

-- Create recipes table
CREATE TABLE IF NOT EXISTS "recipes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "item_id" uuid REFERENCES "items"("id"),
  "name" varchar(255) NOT NULL,
  "description" text,
  "yield_quantity" decimal(12,2) NOT NULL DEFAULT '1',
  "yield_unit" varchar(50) DEFAULT 'portion',
  "preparation_time" integer,
  "instructions" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create recipe_ingredients table
CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "ingredient_item_id" uuid NOT NULL REFERENCES "items"("id"),
  "quantity" decimal(12,4) NOT NULL,
  "unit" varchar(50) NOT NULL DEFAULT 'pcs',
  "waste_percentage" decimal(5,2) DEFAULT '0',
  "notes" text,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create waste_log table
CREATE TABLE IF NOT EXISTS "waste_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "quantity" decimal(12,4) NOT NULL,
  "unit" varchar(50) NOT NULL DEFAULT 'pcs',
  "reason" varchar(100) NOT NULL,
  "notes" text,
  "cost_amount" decimal(12,2),
  "recorded_by" uuid REFERENCES "users"("id"),
  "recorded_at" timestamp DEFAULT now() NOT NULL
);

-- Unique index: one recipe per menu item per tenant
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_tenant_item_idx" ON "recipes" ("tenant_id", "item_id") WHERE "item_id" IS NOT NULL;

-- Index for recipe lookups
CREATE INDEX IF NOT EXISTS "recipes_tenant_idx" ON "recipes" ("tenant_id");
CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipe_idx" ON "recipe_ingredients" ("recipe_id");
CREATE INDEX IF NOT EXISTS "waste_log_tenant_idx" ON "waste_log" ("tenant_id");
CREATE INDEX IF NOT EXISTS "waste_log_item_idx" ON "waste_log" ("item_id");
CREATE INDEX IF NOT EXISTS "waste_log_recorded_at_idx" ON "waste_log" ("recorded_at");

-- Enable RLS
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_log" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for recipes
DO $$ BEGIN
  CREATE POLICY "recipes_tenant_isolation" ON "recipes"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "recipes_tenant_insert" ON "recipes"
    FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- RLS Policies for recipe_ingredients
DO $$ BEGIN
  CREATE POLICY "recipe_ingredients_tenant_isolation" ON "recipe_ingredients"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "recipe_ingredients_tenant_insert" ON "recipe_ingredients"
    FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- RLS Policies for waste_log
DO $$ BEGIN
  CREATE POLICY "waste_log_tenant_isolation" ON "waste_log"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "waste_log_tenant_insert" ON "waste_log"
    FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Grant permissions to app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipes" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "recipe_ingredients" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "waste_log" TO app_user;
