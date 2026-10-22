-- A vehicle can sit with only one dealer at a time: at most one dealer_allocations row per
-- vehicle may be in status 'allocated'. The API checks this under a row lock on the vehicle;
-- this partial unique index is the database-level backstop against races / direct writes.
-- Idempotent. If existing data already violates the rule the index is skipped with a NOTICE
-- (resolve the duplicates - return all but one allocation - and re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'dealer_allocations_one_active_per_vehicle') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM dealer_allocations
    WHERE status = 'allocated'
    GROUP BY tenant_id, vehicle_inventory_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'dealer_allocations has vehicles with more than one active allocation; unique index not created';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX dealer_allocations_one_active_per_vehicle
    ON dealer_allocations (tenant_id, vehicle_inventory_id)
    WHERE status = 'allocated';
END $$;
