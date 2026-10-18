-- Migration for new tables: revisions, activity logs, templates, attachments

-- Activity Action Enum
CREATE TYPE "public"."activity_action" AS ENUM('create', 'update', 'delete', 'status_change', 'submit', 'approve', 'reject', 'cancel', 'convert', 'login', 'logout', 'print', 'export');--> statement-breakpoint

-- Insurance Estimate Revisions
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
);--> statement-breakpoint

-- Activity Logs
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" "activity_action" NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"entity_name" varchar(255),
	"description" text,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Estimate Templates
CREATE TABLE "estimate_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"items_template" jsonb DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Insurance Estimate Attachments
CREATE TABLE "insurance_estimate_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"file_path" text NOT NULL,
	"category" varchar(50),
	"description" text,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign Keys
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_estimate_id_insurance_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."insurance_estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_revisions" ADD CONSTRAINT "insurance_estimate_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "estimate_templates" ADD CONSTRAINT "estimate_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_templates" ADD CONSTRAINT "estimate_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_estimate_id_insurance_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."insurance_estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Indexes for common queries
CREATE INDEX "activity_logs_tenant_id_idx" ON "activity_logs" ("tenant_id");--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX "insurance_estimate_attachments_estimate_id_idx" ON "insurance_estimate_attachments" ("estimate_id");--> statement-breakpoint
CREATE INDEX "insurance_estimate_revisions_estimate_id_idx" ON "insurance_estimate_revisions" ("estimate_id");
