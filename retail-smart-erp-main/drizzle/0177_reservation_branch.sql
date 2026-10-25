-- K4 (2026-10): branch (warehouse) on restaurant reservations, so branch-restricted staff only see
-- and change their own branches' bookings and cannot seat a guest at another branch's table.
-- Backfill: the branch of the reserved table, else the tenant's default branch (same rule as 0176).
-- Idempotent.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_warehouse ON reservations (tenant_id, warehouse_id);
--> statement-breakpoint
UPDATE reservations r SET warehouse_id = rt.warehouse_id
  FROM restaurant_tables rt WHERE rt.id = r.table_id AND r.warehouse_id IS NULL AND rt.warehouse_id IS NOT NULL;
--> statement-breakpoint
UPDATE reservations r SET warehouse_id = d.warehouse_id
  FROM (
    SELECT t.tenant_id, COALESCE(
        (SELECT w.id FROM warehouses w WHERE w.tenant_id = t.tenant_id AND w.is_default = true
          ORDER BY w.is_active DESC, w.created_at LIMIT 1),
        (SELECT MIN(w.id::text)::uuid FROM warehouses w
          WHERE w.tenant_id = t.tenant_id AND w.is_active = true AND upper(coalesce(w.code, '')) <> 'QUARANTINE'
         HAVING COUNT(*) = 1)
      ) AS warehouse_id
    FROM (SELECT DISTINCT tenant_id FROM warehouses) t
  ) d
 WHERE d.tenant_id = r.tenant_id AND r.warehouse_id IS NULL AND d.warehouse_id IS NOT NULL;
