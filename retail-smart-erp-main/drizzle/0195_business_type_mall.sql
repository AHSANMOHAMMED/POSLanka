-- New business type: mall / department store / multi-shop — one business that runs several kinds
-- of shop (grocery, textile, electronics, stationery, pharmacy, food court…). The kinds it runs are
-- listed in tenants.business_segments (0196). ADD VALUE can't be used in the same transaction it's
-- added in; nothing here uses the new value.
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'mall';
