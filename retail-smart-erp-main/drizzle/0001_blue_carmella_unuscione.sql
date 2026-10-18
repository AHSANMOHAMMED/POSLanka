CREATE TYPE "public"."estimate_item_status" AS ENUM('pending', 'approved', 'price_adjusted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."estimate_item_type" AS ENUM('service', 'part');--> statement-breakpoint
CREATE TYPE "public"."insurance_estimate_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'partially_approved', 'rejected', 'work_order_created', 'cancelled');--> statement-breakpoint
CREATE TABLE "insurance_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"short_name" varchar(50),
	"phone" varchar(50),
	"email" varchar(255),
	"claim_hotline" varchar(50),
	"is_partner_garage" boolean DEFAULT false NOT NULL,
	"estimate_threshold" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_estimate_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"item_type" "estimate_item_type" NOT NULL,
	"service_type_id" uuid,
	"description" text,
	"hours" numeric(6, 2),
	"rate" numeric(12, 2),
	"item_id" uuid,
	"part_name" varchar(255),
	"quantity" numeric(12, 3),
	"unit_price" numeric(12, 2),
	"original_amount" numeric(12, 2) NOT NULL,
	"approved_amount" numeric(12, 2),
	"status" "estimate_item_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"assessor_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_estimate_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"estimate_snapshot" jsonb NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"change_reason" text,
	"changed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_no" varchar(50) NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"insurance_company_id" uuid,
	"policy_number" varchar(100),
	"claim_number" varchar(100),
	"assessor_name" varchar(255),
	"assessor_phone" varchar(50),
	"assessor_email" varchar(255),
	"incident_date" date,
	"incident_description" text,
	"status" "insurance_estimate_status" DEFAULT 'draft' NOT NULL,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"original_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"original_tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"original_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"approved_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"approved_tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"approved_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"insurance_remarks" text,
	"reviewed_at" timestamp,
	"work_order_id" uuid,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp,
	"cancellation_reason" text,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_bundle_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bundle_item_id" uuid NOT NULL,
	"component_item_id" uuid NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_type_bundle_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bundle_service_type_id" uuid NOT NULL,
	"component_service_type_id" uuid NOT NULL,
	"hours" numeric(6, 2),
	"rate" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "service_type_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_bundle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "is_bundle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "insurance_companies" ADD CONSTRAINT "insurance_companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_estimate_id_insurance_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."insurance_estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_estimate_id_insurance_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."insurance_estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_insurance_company_id_insurance_companies_id_fk" FOREIGN KEY ("insurance_company_id") REFERENCES "public"."insurance_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD CONSTRAINT "insurance_estimates_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bundle_components" ADD CONSTRAINT "item_bundle_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bundle_components" ADD CONSTRAINT "item_bundle_components_bundle_item_id_items_id_fk" FOREIGN KEY ("bundle_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bundle_components" ADD CONSTRAINT "item_bundle_components_component_item_id_items_id_fk" FOREIGN KEY ("component_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_type_bundle_components" ADD CONSTRAINT "service_type_bundle_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_type_bundle_components" ADD CONSTRAINT "service_type_bundle_components_bundle_service_type_id_service_types_id_fk" FOREIGN KEY ("bundle_service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_type_bundle_components" ADD CONSTRAINT "service_type_bundle_components_component_service_type_id_service_types_id_fk" FOREIGN KEY ("component_service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_type_groups" ADD CONSTRAINT "service_type_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_group_id_service_type_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."service_type_groups"("id") ON DELETE no action ON UPDATE no action;