CREATE TYPE "public"."estimate_type" AS ENUM('insurance', 'direct');--> statement-breakpoint
ALTER TYPE "public"."estimate_item_status" ADD VALUE 'requires_reinspection';--> statement-breakpoint
CREATE TABLE "insurance_assessors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"insurance_company_id" uuid,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD COLUMN "estimate_type" "estimate_type" DEFAULT 'insurance' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD COLUMN "assessor_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_assessors" ADD CONSTRAINT "insurance_assessors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_assessors" ADD CONSTRAINT "insurance_assessors_insurance_company_id_insurance_companies_id_fk" FOREIGN KEY ("insurance_company_id") REFERENCES "public"."insurance_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_assessor_id_insurance_assessors_id_fk" FOREIGN KEY ("assessor_id") REFERENCES "public"."insurance_assessors"("id") ON DELETE no action ON UPDATE no action;