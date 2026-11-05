-- New business type: textile & clothing shops (sarees, readymade garments, fabric sold by the metre,
-- tailoring / alteration orders). ADD VALUE can't be used in the same transaction it's added in;
-- nothing here uses the new value.
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'textile';
