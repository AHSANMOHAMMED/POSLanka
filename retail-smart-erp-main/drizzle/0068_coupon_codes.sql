-- Coupon/promo code system for marketing campaigns
CREATE TABLE IF NOT EXISTS "coupon_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "description" text,
  "discount_type" varchar(20) NOT NULL DEFAULT 'percentage',
  "discount_value" numeric(10, 2) NOT NULL DEFAULT '0',
  "applicable_tiers" jsonb,
  "min_billing_cycle" varchar(20),
  "max_uses" integer,
  "used_count" integer NOT NULL DEFAULT 0,
  "max_uses_per_account" integer NOT NULL DEFAULT 1,
  "valid_from" timestamp,
  "valid_until" timestamp,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
