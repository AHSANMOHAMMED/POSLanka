-- Restaurant Module Phase 1 Enhancements
-- Adds: reservation enhancements, modifier enhancements, table groups (merge/split), server assignments

-- =============================================
-- 1. Enhance reservations table
-- =============================================

-- Waitlist management
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS waitlist_position integer;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS estimated_seating_time timestamp;

-- Booking source tracking
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS source varchar(50) DEFAULT 'walk_in';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmation_code varchar(20);

-- Reminder tracking
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder_sent_at timestamp;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamp;

-- Customer email for confirmations
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS customer_email varchar(255);

-- Duration estimate in minutes
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS estimated_duration integer DEFAULT 60;

-- Special requests
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS special_requests text;

-- Who created it
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

-- Cancellation tracking
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_at timestamp;

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(tenant_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_confirmation ON reservations(confirmation_code) WHERE confirmation_code IS NOT NULL;

-- =============================================
-- 2. Enhance modifiers tables
-- =============================================

-- Add description and sort order to modifier groups
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

-- Add more fields to modifiers
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS sku varchar(50);
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS allergens text[];
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS calories integer;
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

-- Modifier-to-item association (which menu items a modifier group applies to)
CREATE TABLE IF NOT EXISTS modifier_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(modifier_group_id, item_id)
);

-- Index for modifier group items
CREATE INDEX IF NOT EXISTS idx_modifier_group_items_tenant ON modifier_group_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_modifier_group_items_item ON modifier_group_items(item_id);
CREATE INDEX IF NOT EXISTS idx_modifier_group_items_group ON modifier_group_items(modifier_group_id);

-- =============================================
-- 3. Table groups (merging/splitting)
-- =============================================

CREATE TABLE IF NOT EXISTS table_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(100) NOT NULL,
  combined_capacity integer NOT NULL DEFAULT 0,
  status varchar(50) NOT NULL DEFAULT 'active',
  server_id uuid REFERENCES users(id),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamp DEFAULT now() NOT NULL,
  disbanded_at timestamp
);

CREATE TABLE IF NOT EXISTS table_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  table_group_id uuid NOT NULL REFERENCES table_groups(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES restaurant_tables(id),
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(table_group_id, table_id)
);

-- Index for table groups
CREATE INDEX IF NOT EXISTS idx_table_groups_tenant ON table_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_table_groups_status ON table_groups(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_table_group_members_tenant ON table_group_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_table_group_members_table ON table_group_members(table_id);

-- Add server assignment to restaurant_tables
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS server_id uuid REFERENCES users(id);
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS current_order_id uuid REFERENCES restaurant_orders(id);
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS table_group_id uuid REFERENCES table_groups(id);
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS occupied_at timestamp;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

-- Add waiter/server to restaurant orders
ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS server_id uuid REFERENCES users(id);

-- =============================================
-- 4. RLS policies for new tables
-- =============================================

-- modifier_group_items RLS
ALTER TABLE modifier_group_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS modifier_group_items_tenant_isolation ON modifier_group_items;
CREATE POLICY modifier_group_items_tenant_isolation ON modifier_group_items
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- table_groups RLS
ALTER TABLE table_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS table_groups_tenant_isolation ON table_groups;
CREATE POLICY table_groups_tenant_isolation ON table_groups
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- table_group_members RLS
ALTER TABLE table_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS table_group_members_tenant_isolation ON table_group_members;
CREATE POLICY table_group_members_tenant_isolation ON table_group_members
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
