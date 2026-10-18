-- Dealership Tables
-- Vehicle inventory, test drives, trade-ins, financing, sale details, and warranties

-- Vehicle Inventory - dealership vehicle stock for sale
CREATE TABLE "vehicle_inventory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vin" varchar(50),
  "stock_no" varchar(50),
  "make_id" uuid REFERENCES "vehicle_makes"("id"),
  "model_id" uuid REFERENCES "vehicle_models"("id"),
  "year" integer,
  "trim" varchar(100),
  "exterior_color" varchar(50),
  "interior_color" varchar(50),
  "mileage" integer,
  "condition" varchar(20) DEFAULT 'new',
  "body_type" varchar(50),
  "engine_type" varchar(50),
  "transmission" varchar(50),
  "fuel_type" varchar(50),
  "drivetrain" varchar(50),
  "purchase_price" numeric(12, 2),
  "asking_price" numeric(12, 2),
  "minimum_price" numeric(12, 2),
  "status" varchar(20) DEFAULT 'available',
  "warehouse_id" uuid REFERENCES "warehouses"("id"),
  "location" varchar(100),
  "description" text,
  "features" jsonb DEFAULT '[]',
  "photos" jsonb DEFAULT '[]',
  "purchased_from" varchar(255),
  "purchase_date" date,
  "sold_date" date,
  "sold_price" numeric(12, 2),
  "sale_id" uuid REFERENCES "sales"("id"),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Test Drives - test drive scheduling
CREATE TABLE "test_drives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vehicle_inventory_id" uuid NOT NULL REFERENCES "vehicle_inventory"("id"),
  "customer_id" uuid REFERENCES "customers"("id"),
  "customer_name" varchar(255),
  "customer_phone" varchar(50),
  "customer_email" varchar(255),
  "scheduled_date" date NOT NULL,
  "scheduled_time" varchar(10),
  "duration_minutes" integer DEFAULT 30,
  "status" varchar(20) DEFAULT 'scheduled',
  "salesperson_id" uuid REFERENCES "users"("id"),
  "notes" text,
  "feedback" text,
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Trade-In Vehicles - trade-in evaluations
CREATE TABLE "trade_in_vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "sale_id" uuid REFERENCES "sales"("id"),
  "make" varchar(100),
  "model" varchar(100),
  "year" integer,
  "vin" varchar(50),
  "mileage" integer,
  "condition" varchar(20),
  "color" varchar(50),
  "appraisal_value" numeric(12, 2),
  "trade_in_allowance" numeric(12, 2),
  "condition_notes" text,
  "status" varchar(20) DEFAULT 'pending',
  "added_to_inventory_id" uuid REFERENCES "vehicle_inventory"("id"),
  "appraised_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Financing Options - lender configurations
CREATE TABLE "financing_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "lender_name" varchar(100) NOT NULL,
  "contact_info" varchar(255),
  "loan_type" varchar(50),
  "min_amount" numeric(12, 2),
  "max_amount" numeric(12, 2),
  "min_term_months" integer,
  "max_term_months" integer,
  "interest_rate_min" numeric(5, 2),
  "interest_rate_max" numeric(5, 2),
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Vehicle Sale Details - extended sale info for vehicle sales
CREATE TABLE "vehicle_sale_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "sale_id" uuid NOT NULL REFERENCES "sales"("id"),
  "vehicle_inventory_id" uuid NOT NULL REFERENCES "vehicle_inventory"("id"),
  "trade_in_vehicle_id" uuid REFERENCES "trade_in_vehicles"("id"),
  "trade_in_allowance" numeric(12, 2),
  "financing_option_id" uuid REFERENCES "financing_options"("id"),
  "down_payment" numeric(12, 2),
  "finance_amount" numeric(12, 2),
  "loan_term_months" integer,
  "interest_rate" numeric(5, 2),
  "monthly_payment" numeric(12, 2),
  "warranty_type" varchar(50),
  "warranty_months" integer,
  "warranty_mileage" integer,
  "warranty_price" numeric(12, 2),
  "salesperson_id" uuid REFERENCES "users"("id"),
  "commission_amount" numeric(12, 2),
  "delivery_date" date,
  "delivery_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Vehicle Warranties - warranty tracking for sold vehicles
CREATE TABLE "vehicle_warranties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "sale_id" uuid NOT NULL REFERENCES "sales"("id"),
  "vehicle_inventory_id" uuid NOT NULL REFERENCES "vehicle_inventory"("id"),
  "warranty_type" varchar(50),
  "provider" varchar(255),
  "policy_number" varchar(100),
  "start_date" date,
  "end_date" date,
  "mileage_limit" integer,
  "coverage_details" text,
  "price" numeric(12, 2),
  "status" varchar(20) DEFAULT 'active',
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
-- vehicle_inventory
CREATE UNIQUE INDEX "vehicle_inventory_tenant_vin" ON "vehicle_inventory" ("tenant_id", "vin");
CREATE INDEX "idx_vehicle_inventory_tenant" ON "vehicle_inventory" ("tenant_id");
CREATE INDEX "idx_vehicle_inventory_status" ON "vehicle_inventory" ("tenant_id", "status");
CREATE INDEX "idx_vehicle_inventory_make" ON "vehicle_inventory" ("make_id");
CREATE INDEX "idx_vehicle_inventory_model" ON "vehicle_inventory" ("model_id");
CREATE INDEX "idx_vehicle_inventory_sale" ON "vehicle_inventory" ("sale_id");

-- test_drives
CREATE INDEX "idx_test_drives_tenant" ON "test_drives" ("tenant_id");
CREATE INDEX "idx_test_drives_status" ON "test_drives" ("tenant_id", "status");
CREATE INDEX "idx_test_drives_vehicle" ON "test_drives" ("vehicle_inventory_id");
CREATE INDEX "idx_test_drives_customer" ON "test_drives" ("customer_id");
CREATE INDEX "idx_test_drives_salesperson" ON "test_drives" ("salesperson_id");
CREATE INDEX "idx_test_drives_date" ON "test_drives" ("scheduled_date");

-- trade_in_vehicles
CREATE INDEX "idx_trade_in_vehicles_tenant" ON "trade_in_vehicles" ("tenant_id");
CREATE INDEX "idx_trade_in_vehicles_status" ON "trade_in_vehicles" ("tenant_id", "status");
CREATE INDEX "idx_trade_in_vehicles_sale" ON "trade_in_vehicles" ("sale_id");

-- financing_options
CREATE INDEX "idx_financing_options_tenant" ON "financing_options" ("tenant_id");

-- vehicle_sale_details
CREATE UNIQUE INDEX "vehicle_sale_details_sale_unique" ON "vehicle_sale_details" ("sale_id");
CREATE INDEX "idx_vehicle_sale_details_tenant" ON "vehicle_sale_details" ("tenant_id");
CREATE INDEX "idx_vehicle_sale_details_vehicle" ON "vehicle_sale_details" ("vehicle_inventory_id");
CREATE INDEX "idx_vehicle_sale_details_salesperson" ON "vehicle_sale_details" ("salesperson_id");

-- vehicle_warranties
CREATE INDEX "idx_vehicle_warranties_tenant" ON "vehicle_warranties" ("tenant_id");
CREATE INDEX "idx_vehicle_warranties_status" ON "vehicle_warranties" ("tenant_id", "status");
CREATE INDEX "idx_vehicle_warranties_sale" ON "vehicle_warranties" ("sale_id");
CREATE INDEX "idx_vehicle_warranties_vehicle" ON "vehicle_warranties" ("vehicle_inventory_id");

-- Enable RLS
ALTER TABLE "vehicle_inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_drives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trade_in_vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financing_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_sale_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_warranties" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation_policy" ON "vehicle_inventory"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "test_drives"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "trade_in_vehicles"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "financing_options"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "vehicle_sale_details"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "vehicle_warranties"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicle_inventory" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "test_drives" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "trade_in_vehicles" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "financing_options" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicle_sale_details" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicle_warranties" TO app_user;
