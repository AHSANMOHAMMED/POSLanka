CREATE TYPE "public"."activity_action" AS ENUM('create', 'update', 'delete', 'status_change', 'submit', 'approve', 'reject', 'cancel', 'convert', 'login', 'logout', 'print', 'export');--> statement-breakpoint
CREATE TYPE "public"."recurrence_pattern" AS ENUM('none', 'daily', 'weekly', 'biweekly', 'monthly');--> statement-breakpoint
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
);
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE TABLE "held_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hold_number" varchar(20) NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"customer_name" varchar(255),
	"vehicle_plate" varchar(20),
	"vehicle_description" varchar(255),
	"cart_items" jsonb NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"held_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_estimate_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"file_path" text NOT NULL,
	"file_hash" varchar(64),
	"category" varchar(50),
	"description" text,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_ownership_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"customer_id" uuid,
	"previous_customer_id" uuid,
	"vehicle_plate" varchar(20),
	"vehicle_description" varchar(255),
	"customer_name" varchar(255),
	"previous_customer_name" varchar(255),
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"changed_by_name" varchar(255),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "work_order_assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"assigned_to" uuid,
	"previous_assigned_to" uuid,
	"assigned_to_name" varchar(255),
	"previous_assigned_to_name" varchar(255),
	"changed_by" uuid,
	"changed_by_name" varchar(255),
	"reason" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_zones" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "vehicle_type_diagram_zones" CASCADE;--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" ALTER COLUMN "view_name" SET DEFAULT 'top';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "vehicle_plate" varchar(20);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "vehicle_description" varchar(255);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_name" varchar(255);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "recurrence_pattern" "recurrence_pattern" DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "recurrence_end_date" date;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "parent_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD COLUMN "bundle_item_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD COLUMN "bundle_instance_id" varchar(100);--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD COLUMN "converted_to_work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD COLUMN "conversion_skipped_reason" text;--> statement-breakpoint
ALTER TABLE "insurance_estimates" ADD COLUMN "hold_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vehicle_plate" varchar(20);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "vehicle_description" varchar(255);--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "bundle_item_id" uuid;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD COLUMN "bundle_instance_id" varchar(100);--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "vehicle_plate" varchar(20);--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "vehicle_description" varchar(255);--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "assigned_to_name" varchar(255);--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_templates" ADD CONSTRAINT "estimate_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_templates" ADD CONSTRAINT "estimate_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_sales" ADD CONSTRAINT "held_sales_held_by_users_id_fk" FOREIGN KEY ("held_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_estimate_id_insurance_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."insurance_estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_attachments" ADD CONSTRAINT "insurance_estimate_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownership_history" ADD CONSTRAINT "vehicle_ownership_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownership_history" ADD CONSTRAINT "vehicle_ownership_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownership_history" ADD CONSTRAINT "vehicle_ownership_history_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownership_history" ADD CONSTRAINT "vehicle_ownership_history_previous_customer_id_customers_id_fk" FOREIGN KEY ("previous_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownership_history" ADD CONSTRAINT "vehicle_ownership_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignment_history" ADD CONSTRAINT "work_order_assignment_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignment_history" ADD CONSTRAINT "work_order_assignment_history_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignment_history" ADD CONSTRAINT "work_order_assignment_history_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignment_history" ADD CONSTRAINT "work_order_assignment_history_previous_assigned_to_users_id_fk" FOREIGN KEY ("previous_assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignment_history" ADD CONSTRAINT "work_order_assignment_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_bundle_item_id_items_id_fk" FOREIGN KEY ("bundle_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_estimate_items" ADD CONSTRAINT "insurance_estimate_items_converted_to_work_order_id_work_orders_id_fk" FOREIGN KEY ("converted_to_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_bundle_item_id_items_id_fk" FOREIGN KEY ("bundle_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" DROP COLUMN "zone_code";--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" DROP COLUMN "svg_content";