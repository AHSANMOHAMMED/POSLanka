-- Add serial_number_ids jsonb column to sale_items and stock_transfer_items
-- Stores array of serial number UUIDs allocated to each line item

ALTER TABLE sale_items ADD COLUMN serial_number_ids jsonb;
ALTER TABLE stock_transfer_items ADD COLUMN serial_number_ids jsonb;
