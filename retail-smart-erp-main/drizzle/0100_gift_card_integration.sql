-- Gift Card Integration: Add accounting, item, and purchase tracking fields

-- Add gift card liability account to accounting settings
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "default_gift_card_liability_account_id" uuid REFERENCES "chart_of_accounts"("id");

-- Add is_gift_card flag to items (for selling gift cards as POS items)
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_gift_card" boolean NOT NULL DEFAULT false;

-- Add purchase_sale_id to gift_cards (links card to the sale that created it)
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "purchase_sale_id" uuid REFERENCES "sales"("id");
