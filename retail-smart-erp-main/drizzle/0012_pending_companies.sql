-- Create pending company status enum
CREATE TYPE "public"."pending_company_status" AS ENUM('pending_payment', 'pending_approval', 'approved', 'rejected', 'expired');--> statement-breakpoint

-- Create pending_companies table
CREATE TABLE "pending_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"business_type" "business_type" NOT NULL,
	"country" varchar(2) NOT NULL,
	"date_format" varchar(20) NOT NULL,
	"time_format" varchar(10) NOT NULL,
	"tier_id" uuid NOT NULL,
	"billing_cycle" varchar(20) DEFAULT 'monthly' NOT NULL,
	"status" "pending_company_status" DEFAULT 'pending_payment' NOT NULL,
	"payment_deposit_id" uuid,
	"expires_at" timestamp NOT NULL,
	"admin_notes" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Add pending_company_id column to payment_deposits
ALTER TABLE "payment_deposits" ADD COLUMN "pending_company_id" uuid;--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "pending_companies" ADD CONSTRAINT "pending_companies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_companies" ADD CONSTRAINT "pending_companies_tier_id_pricing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pricing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deposits" ADD CONSTRAINT "payment_deposits_pending_company_id_pending_companies_id_fk" FOREIGN KEY ("pending_company_id") REFERENCES "public"."pending_companies"("id") ON DELETE no action ON UPDATE no action;
