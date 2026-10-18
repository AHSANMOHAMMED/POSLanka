-- Serial Number Tracking
-- Lean schema: serial number rows track item+warehouse+status+warranty only.
-- All transaction linkage goes through serial_number_movements (audit log).

-- =============================================
-- 1. Serial number status enum
-- =============================================

CREATE TYPE serial_number_status AS ENUM (
  'available', 'reserved', 'sold', 'returned', 'defective', 'scrapped', 'lost'
);

-- =============================================
-- 2. Add trackSerialNumbers flag to items
-- =============================================

ALTER TABLE items ADD COLUMN IF NOT EXISTS track_serial_numbers boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_items_track_serial_numbers
  ON items(tenant_id) WHERE track_serial_numbers = true;

-- =============================================
-- 3. item_serial_numbers table
-- =============================================

CREATE TABLE IF NOT EXISTS item_serial_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid REFERENCES warehouses(id),

  serial_number varchar(255) NOT NULL,
  status serial_number_status NOT NULL DEFAULT 'available',

  -- Warranty tracking
  warranty_start_date date,
  warranty_end_date date,
  warranty_notes text,

  -- Metadata
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, item_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_serial_numbers_tenant_item ON item_serial_numbers(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_serial_numbers_number ON item_serial_numbers(tenant_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_serial_numbers_status ON item_serial_numbers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_serial_numbers_warehouse ON item_serial_numbers(tenant_id, warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_serial_numbers_warranty ON item_serial_numbers(tenant_id, warranty_end_date) WHERE warranty_end_date IS NOT NULL;

-- =============================================
-- 4. serial_number_movements table (audit log)
-- =============================================

CREATE TABLE IF NOT EXISTS serial_number_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  serial_number_id uuid NOT NULL REFERENCES item_serial_numbers(id),

  from_status serial_number_status,
  to_status serial_number_status NOT NULL,

  -- Warehouse tracking for transfers
  from_warehouse_id uuid REFERENCES warehouses(id),
  to_warehouse_id uuid REFERENCES warehouses(id),

  -- Transaction reference
  reference_type varchar(50),
  reference_id uuid,

  -- Who and when
  changed_by uuid REFERENCES users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serial_movements_serial ON serial_number_movements(serial_number_id);
CREATE INDEX IF NOT EXISTS idx_serial_movements_tenant ON serial_number_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_serial_movements_reference ON serial_number_movements(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- =============================================
-- 5. RLS policies
-- =============================================

ALTER TABLE item_serial_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_serial_numbers_tenant_isolation ON item_serial_numbers;
CREATE POLICY item_serial_numbers_tenant_isolation ON item_serial_numbers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE serial_number_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS serial_number_movements_tenant_isolation ON serial_number_movements;
CREATE POLICY serial_number_movements_tenant_isolation ON serial_number_movements
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
