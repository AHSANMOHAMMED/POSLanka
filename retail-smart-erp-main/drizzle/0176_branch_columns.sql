-- K4 (2026-10): branch (warehouse) on restaurant tables and orders, appointments and purchase
-- requisition headers, so staff restricted to some branches (user_warehouses) only see and change
-- the records of those branches (src/lib/auth/branch-access.ts). Nullable: a record without a
-- branch is only visible to unrestricted users (the owner and staff with no branch assignment).
-- Backfill ("default branch" = the tenant's is_default warehouse; a tenant without one but with
-- exactly one active branch uses that one):
--  * restaurant tables: the default branch.
--  * restaurant orders: the branch of the sale they were billed on, else of their table, else default.
--  * appointments: the branch of their work order, else default.
--  * requisition headers: the branch of their first line that has one, else default.
-- Idempotent.
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_tenant_warehouse ON restaurant_tables (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_restaurant_orders_tenant_warehouse ON restaurant_orders (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_warehouse ON appointments (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_tenant_warehouse ON purchase_requisitions (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS _k4_default_branch AS
  SELECT t.tenant_id, COALESCE(
      (SELECT w.id FROM warehouses w WHERE w.tenant_id = t.tenant_id AND w.is_default = true
        ORDER BY w.is_active DESC, w.created_at LIMIT 1),
      (SELECT MIN(w.id::text)::uuid FROM warehouses w
        WHERE w.tenant_id = t.tenant_id AND w.is_active = true AND upper(coalesce(w.code, '')) <> 'QUARANTINE'
       HAVING COUNT(*) = 1)
    ) AS warehouse_id
  FROM (SELECT DISTINCT tenant_id FROM warehouses) t;
--> statement-breakpoint
UPDATE restaurant_tables rt SET warehouse_id = d.warehouse_id
  FROM _k4_default_branch d WHERE d.tenant_id = rt.tenant_id AND rt.warehouse_id IS NULL AND d.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE restaurant_orders ro SET warehouse_id = s.warehouse_id
  FROM sales s WHERE s.id = ro.sale_id AND ro.warehouse_id IS NULL AND s.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE restaurant_orders ro SET warehouse_id = rt.warehouse_id
  FROM restaurant_tables rt WHERE rt.id = ro.table_id AND ro.warehouse_id IS NULL AND rt.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE restaurant_orders ro SET warehouse_id = d.warehouse_id
  FROM _k4_default_branch d WHERE d.tenant_id = ro.tenant_id AND ro.warehouse_id IS NULL AND d.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE appointments a SET warehouse_id = wo.warehouse_id
  FROM work_orders wo WHERE wo.id = a.work_order_id AND a.warehouse_id IS NULL AND wo.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE appointments a SET warehouse_id = d.warehouse_id
  FROM _k4_default_branch d WHERE d.tenant_id = a.tenant_id AND a.warehouse_id IS NULL AND d.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE purchase_requisitions pr SET warehouse_id = l.warehouse_id
  FROM (SELECT DISTINCT ON (requisition_id) requisition_id, warehouse_id
          FROM purchase_requisition_items WHERE warehouse_id IS NOT NULL
         ORDER BY requisition_id, ctid) l
 WHERE l.requisition_id = pr.id AND pr.warehouse_id IS NULL;
--> statement-breakpoint
UPDATE purchase_requisitions pr SET warehouse_id = d.warehouse_id
  FROM _k4_default_branch d WHERE d.tenant_id = pr.tenant_id AND pr.warehouse_id IS NULL AND d.warehouse_id IS NOT NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS _k4_default_branch;
