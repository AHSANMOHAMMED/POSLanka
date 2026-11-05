-- Mall / multi-shop business types (2026-11).
--  * tenants.business_segments: the business types a 'mall' runs (e.g. {supermarket,textile,
--    electronics,restaurant}); menus, features, roles and reports follow all of them.
--    NULL for every other business type — nothing changes for existing shops.
--  * pos_profiles.business_segment: which of those a till / counter works as (a food-court counter
--    works as 'restaurant', a grocery counter as 'supermarket'). NULL = the business's main type.
-- Additive and idempotent.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_segments text[];
--> statement-breakpoint
ALTER TABLE pos_profiles ADD COLUMN IF NOT EXISTS business_segment varchar(30);
