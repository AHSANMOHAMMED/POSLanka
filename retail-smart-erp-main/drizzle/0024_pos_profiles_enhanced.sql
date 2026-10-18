-- Enhanced POS Profiles System Migration
-- ERPNext-style POS with shift management, discount handling, and profile configuration

-- =====================================================
-- ENUMS
-- =====================================================

-- Discount type enum
DO $$ BEGIN
    CREATE TYPE discount_type AS ENUM ('percentage', 'fixed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- POS shift status enum
DO $$ BEGIN
    CREATE TYPE pos_shift_status AS ENUM ('open', 'closed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- POS closing status enum
DO $$ BEGIN
    CREATE TYPE pos_closing_status AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- ENHANCED POS PROFILES
-- =====================================================

-- Rename existing pos_profiles to pos_profiles_old for migration
ALTER TABLE IF EXISTS pos_profiles RENAME TO pos_profiles_old;

-- Create new enhanced pos_profiles table
CREATE TABLE pos_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20),
    is_default BOOLEAN DEFAULT false,

    -- Core Settings
    warehouse_id UUID REFERENCES warehouses(id),
    default_customer_id UUID REFERENCES customers(id),

    -- Tax (basic - full Tax Engine planned for future)
    tax_rate DECIMAL(5,2) DEFAULT 0,
    tax_inclusive BOOLEAN DEFAULT false,
    apply_discount_on VARCHAR(20) DEFAULT 'grand_total', -- 'grand_total', 'net_total'

    -- Permissions
    allow_rate_change BOOLEAN DEFAULT true,
    allow_discount_change BOOLEAN DEFAULT true,
    max_discount_percent DECIMAL(5,2) DEFAULT 100,
    allow_negative_stock BOOLEAN DEFAULT false,
    validate_stock_on_save BOOLEAN DEFAULT true,

    -- Display Options
    hide_unavailable_items BOOLEAN DEFAULT true,
    auto_add_item_to_cart BOOLEAN DEFAULT false,

    -- Print Settings
    print_receipt_on_complete BOOLEAN DEFAULT false,
    receipt_print_format VARCHAR(20) DEFAULT '80mm', -- '58mm', '80mm', 'A4'
    show_logo_on_receipt BOOLEAN DEFAULT true,
    receipt_header TEXT,
    receipt_footer TEXT,

    -- Payment Settings
    default_payment_method VARCHAR(30) DEFAULT 'cash',
    allow_credit_sale BOOLEAN DEFAULT true,

    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Migrate data from old table
INSERT INTO pos_profiles (id, tenant_id, name, warehouse_id, status, created_at, updated_at)
SELECT
    p.id,
    p.tenant_id,
    COALESCE(u.full_name || '''s Profile', 'POS Profile'),
    p.warehouse_id,
    CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END,
    p.created_at,
    p.updated_at
FROM pos_profiles_old p
LEFT JOIN users u ON p.user_id = u.id;

-- =====================================================
-- POS PROFILE CHILD TABLES
-- =====================================================

-- POS Profile Payment Methods (enabled payment methods per profile)
CREATE TABLE pos_profile_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pos_profile_id UUID NOT NULL REFERENCES pos_profiles(id) ON DELETE CASCADE,
    payment_method VARCHAR(30) NOT NULL, -- 'cash', 'card', 'bank_transfer', 'credit', 'gift_card'
    is_default BOOLEAN DEFAULT false,
    allow_in_returns BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0
);

-- POS Profile Users (who can use this profile)
CREATE TABLE pos_profile_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    pos_profile_id UUID NOT NULL REFERENCES pos_profiles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(pos_profile_id, user_id)
);

-- Migrate old pos_profiles user assignments
INSERT INTO pos_profile_users (tenant_id, pos_profile_id, user_id, is_default, created_at)
SELECT
    tenant_id,
    id as pos_profile_id,
    user_id,
    true,
    created_at
FROM pos_profiles_old;

-- POS Profile Item Groups (filter items by category)
CREATE TABLE pos_profile_item_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pos_profile_id UUID NOT NULL REFERENCES pos_profiles(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(pos_profile_id, category_id)
);

-- =====================================================
-- POS SHIFT MANAGEMENT
-- =====================================================

-- POS Opening Entry (shift start)
CREATE TABLE pos_opening_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entry_number VARCHAR(30) NOT NULL,

    pos_profile_id UUID NOT NULL REFERENCES pos_profiles(id),
    user_id UUID NOT NULL REFERENCES users(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),

    opening_time TIMESTAMP NOT NULL DEFAULT NOW(),
    status pos_shift_status DEFAULT 'open',

    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Opening Entry Payment Balances (cash in drawer at start)
CREATE TABLE pos_opening_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    opening_entry_id UUID NOT NULL REFERENCES pos_opening_entries(id) ON DELETE CASCADE,
    payment_method VARCHAR(30) NOT NULL,
    opening_amount DECIMAL(15,2) NOT NULL DEFAULT 0
);

-- POS Closing Entry (shift end)
CREATE TABLE pos_closing_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entry_number VARCHAR(30) NOT NULL,

    opening_entry_id UUID NOT NULL REFERENCES pos_opening_entries(id),
    pos_profile_id UUID NOT NULL REFERENCES pos_profiles(id),
    user_id UUID NOT NULL REFERENCES users(id),

    opening_time TIMESTAMP NOT NULL,
    closing_time TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Totals
    total_sales DECIMAL(15,2) DEFAULT 0,
    total_returns DECIMAL(15,2) DEFAULT 0,
    net_sales DECIMAL(15,2) DEFAULT 0,
    total_transactions INT DEFAULT 0,

    status pos_closing_status DEFAULT 'draft',
    submitted_at TIMESTAMP,
    submitted_by UUID REFERENCES users(id),

    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Closing Entry Payment Reconciliation
CREATE TABLE pos_closing_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    closing_entry_id UUID NOT NULL REFERENCES pos_closing_entries(id) ON DELETE CASCADE,
    payment_method VARCHAR(30) NOT NULL,
    opening_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    expected_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    actual_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    difference DECIMAL(15,2) GENERATED ALWAYS AS (actual_amount - expected_amount) STORED
);

-- =====================================================
-- MODIFY SALES TABLE
-- =====================================================

-- Add shift link and discount fields to sales
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS pos_opening_entry_id UUID REFERENCES pos_opening_entries(id),
ADD COLUMN IF NOT EXISTS discount_type discount_type,
ADD COLUMN IF NOT EXISTS discount_reason TEXT;

-- Add tax and discount tracking to sale_items
ALTER TABLE sale_items
ADD COLUMN IF NOT EXISTS discount_type discount_type,
ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 0;

-- =====================================================
-- LOYALTY PROGRAMS (Enhanced)
-- =====================================================

-- Loyalty Program Configuration
CREATE TABLE loyalty_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,

    -- Points Configuration
    collection_factor DECIMAL(10,4) DEFAULT 1, -- points per currency unit
    conversion_factor DECIMAL(10,4) DEFAULT 0.01, -- currency per point
    min_redemption_points INT DEFAULT 100,

    -- Expiry
    points_expire BOOLEAN DEFAULT false,
    expiry_days INT DEFAULT 365,

    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_pos_profiles_tenant ON pos_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_profiles_status ON pos_profiles(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_pos_profile_users_profile ON pos_profile_users(pos_profile_id);
CREATE INDEX IF NOT EXISTS idx_pos_profile_users_user ON pos_profile_users(user_id);
CREATE INDEX IF NOT EXISTS idx_pos_profile_users_tenant ON pos_profile_users(tenant_id);

CREATE INDEX IF NOT EXISTS idx_pos_opening_entries_tenant ON pos_opening_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_opening_entries_user ON pos_opening_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_pos_opening_entries_status ON pos_opening_entries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_opening_entries_profile ON pos_opening_entries(pos_profile_id);

CREATE INDEX IF NOT EXISTS idx_pos_closing_entries_tenant ON pos_closing_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_closing_entries_opening ON pos_closing_entries(opening_entry_id);

CREATE INDEX IF NOT EXISTS idx_sales_opening_entry ON sales(pos_opening_entry_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_programs_tenant ON loyalty_programs(tenant_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE pos_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_item_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;

-- Policies for pos_profiles
DROP POLICY IF EXISTS pos_profiles_tenant_isolation ON pos_profiles;
CREATE POLICY pos_profiles_tenant_isolation ON pos_profiles
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for pos_profile_payment_methods (via join to pos_profiles)
DROP POLICY IF EXISTS pos_profile_payment_methods_tenant_isolation ON pos_profile_payment_methods;
CREATE POLICY pos_profile_payment_methods_tenant_isolation ON pos_profile_payment_methods
    USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- Policies for pos_profile_users
DROP POLICY IF EXISTS pos_profile_users_tenant_isolation ON pos_profile_users;
CREATE POLICY pos_profile_users_tenant_isolation ON pos_profile_users
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for pos_profile_item_groups (via join)
DROP POLICY IF EXISTS pos_profile_item_groups_tenant_isolation ON pos_profile_item_groups;
CREATE POLICY pos_profile_item_groups_tenant_isolation ON pos_profile_item_groups
    USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- Policies for pos_opening_entries
DROP POLICY IF EXISTS pos_opening_entries_tenant_isolation ON pos_opening_entries;
CREATE POLICY pos_opening_entries_tenant_isolation ON pos_opening_entries
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for pos_opening_balances
DROP POLICY IF EXISTS pos_opening_balances_tenant_isolation ON pos_opening_balances;
CREATE POLICY pos_opening_balances_tenant_isolation ON pos_opening_balances
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for pos_closing_entries
DROP POLICY IF EXISTS pos_closing_entries_tenant_isolation ON pos_closing_entries;
CREATE POLICY pos_closing_entries_tenant_isolation ON pos_closing_entries
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for pos_closing_reconciliation
DROP POLICY IF EXISTS pos_closing_reconciliation_tenant_isolation ON pos_closing_reconciliation;
CREATE POLICY pos_closing_reconciliation_tenant_isolation ON pos_closing_reconciliation
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Policies for loyalty_programs
DROP POLICY IF EXISTS loyalty_programs_tenant_isolation ON loyalty_programs;
CREATE POLICY loyalty_programs_tenant_isolation ON loyalty_programs
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- =====================================================
-- CLEANUP
-- =====================================================

-- Drop old table after migration is verified
-- Note: Run this manually after verifying data migration
-- DROP TABLE IF EXISTS pos_profiles_old;

-- Add comment to remind about cleanup
COMMENT ON TABLE pos_profiles IS 'Enhanced POS profiles with ERPNext-style configuration. Old pos_profiles_old table can be dropped after verification.';
