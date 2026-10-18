CREATE TYPE "public"."checklist_item_type" AS ENUM('checkbox', 'select', 'text', 'number');--> statement-breakpoint
CREATE TYPE "public"."checklist_response" AS ENUM('ok', 'concern', 'fail', 'na');--> statement-breakpoint
CREATE TYPE "public"."damage_severity" AS ENUM('minor', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."damage_type" AS ENUM('scratch', 'dent', 'crack', 'rust', 'paint', 'broken', 'missing', 'other');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('draft', 'completed');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('check_in', 'check_out');--> statement-breakpoint
CREATE TYPE "public"."vehicle_body_type" AS ENUM('motorcycle', 'scooter', 'three_wheeler', 'sedan', 'hatchback', 'suv', 'pickup', 'van', 'coupe', 'wagon', 'convertible', 'mini_truck', 'lorry', 'bus', 'other');--> statement-breakpoint
CREATE TABLE "inspection_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"item_name" varchar(255) NOT NULL,
	"item_type" "checklist_item_type" DEFAULT 'checkbox' NOT NULL,
	"options" jsonb DEFAULT '[]',
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_damage_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"diagram_view_id" uuid,
	"zone_code" varchar(50),
	"position_x" numeric(6, 2) NOT NULL,
	"position_y" numeric(6, 2) NOT NULL,
	"damage_type" "damage_type" NOT NULL,
	"severity" "damage_severity" DEFAULT 'minor' NOT NULL,
	"description" text,
	"is_pre_existing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"damage_mark_id" uuid,
	"response_id" uuid,
	"photo_url" varchar(500) NOT NULL,
	"caption" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"response" "checklist_response",
	"value" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "inspection_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"vehicle_type_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"inspection_type" "inspection_type" DEFAULT 'check_in' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"template_id" uuid,
	"inspection_type" "inspection_type" DEFAULT 'check_in' NOT NULL,
	"status" "inspection_status" DEFAULT 'draft' NOT NULL,
	"fuel_level" integer,
	"odometer_reading" integer,
	"inspected_by" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"customer_signature" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_type_diagram_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_type_id" uuid NOT NULL,
	"view_name" varchar(50) NOT NULL,
	"svg_content" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_type_diagram_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagram_view_id" uuid NOT NULL,
	"zone_name" varchar(100) NOT NULL,
	"zone_code" varchar(50) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" varchar(100) NOT NULL,
	"body_type" "vehicle_body_type" NOT NULL,
	"description" text,
	"wheel_count" integer DEFAULT 4 NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vehicle_type_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_categories" ADD CONSTRAINT "inspection_categories_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_checklist_items" ADD CONSTRAINT "inspection_checklist_items_category_id_inspection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inspection_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_diagram_view_id_vehicle_type_diagram_views_id_fk" FOREIGN KEY ("diagram_view_id") REFERENCES "public"."vehicle_type_diagram_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_damage_mark_id_inspection_damage_marks_id_fk" FOREIGN KEY ("damage_mark_id") REFERENCES "public"."inspection_damage_marks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_response_id_inspection_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."inspection_responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_responses" ADD CONSTRAINT "inspection_responses_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_responses" ADD CONSTRAINT "inspection_responses_checklist_item_id_inspection_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."inspection_checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_views" ADD CONSTRAINT "vehicle_type_diagram_views_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_type_diagram_zones" ADD CONSTRAINT "vehicle_type_diagram_zones_diagram_view_id_vehicle_type_diagram_views_id_fk" FOREIGN KEY ("diagram_view_id") REFERENCES "public"."vehicle_type_diagram_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE no action ON UPDATE no action;