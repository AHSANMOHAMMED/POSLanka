-- POSLanka: customer quotations, credit notes, item variants
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'converted', 'expired', 'cancelled');
CREATE TYPE "public"."credit_note_status" AS ENUM('draft', 'issued', 'applied', 'cancelled');

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "parent_item_id" uuid;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "variant_attributes" jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "quotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "quotation_no" varchar(50) NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id"),
  "customer_name" varchar(255),
  "customer_phone" varchar(50),
  "customer_email" varchar(255),
  "status" "quotation_status" DEFAULT 'draft' NOT NULL,
  "subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
  "discount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "notes" text,
  "valid_until" date,
  "converted_sale_id" uuid,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "quotation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "quotation_id" uuid NOT NULL REFERENCES "quotations"("id") ON DELETE cascade,
  "item_id" uuid REFERENCES "items"("id"),
  "item_name" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "discount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL
);

CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "credit_note_no" varchar(50) NOT NULL,
  "sale_id" uuid REFERENCES "sales"("id"),
  "customer_id" uuid REFERENCES "customers"("id"),
  "customer_name" varchar(255),
  "status" "credit_note_status" DEFAULT 'draft' NOT NULL,
  "reason" text,
  "subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "credit_note_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "credit_note_id" uuid NOT NULL REFERENCES "credit_notes"("id") ON DELETE cascade,
  "item_id" uuid REFERENCES "items"("id"),
  "item_name" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_quotations_tenant" ON "quotations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_credit_notes_tenant" ON "credit_notes" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_items_parent" ON "items" ("parent_item_id");
