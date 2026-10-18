-- Add restaurant_order_id column to sales table for linking sales to restaurant orders
ALTER TABLE sales ADD COLUMN IF NOT EXISTS restaurant_order_id UUID REFERENCES restaurant_orders(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sales_restaurant_order_id ON sales(restaurant_order_id);
