# Pricing integration plan (H5): price lists, promotions, units of measure

Status (2026-10-22): **implemented.** `POST /api/sales` prices through
`src/lib/pricing/sale-pricing.ts` (`priceSaleCart`, `recordPromotionRedemptions`); void reverses
usage (`reversePromotionRedemptions`); returns / void move `quantity × uom_factor`; exchanges use the
resolved price for the rate-change rule (no promotions, base unit only); the web POS
(`src/components/pos/price-quote.ts`) and the mobile POS (`apps/mobile/src/lib/cartPricing.ts`,
offline engine on the bundle) quote and send `uom`, `priceLocked`, `promotionDiscount`, `couponCodes`,
`soldAt`. Deviations from the plan below: stale prices / promotion mismatches answer **409**
`PRICE_CHANGED` with `quote`; the client's line `discount` and sale `discount` are manual only and the
cart promotion travels as `promotionDiscount`. Not done: coupon entry on mobile, web offline engine
(web offline sales are accepted and flagged), units in exchanges. Tests: scripts/tests/h5-pricing-catalog.ts.

## What exists

| Piece | Where |
|---|---|
| Pure engine `priceCart(ctx, lines)`, `localClock`, `scheduleOpen`, `promotionLabel` | `src/lib/pricing/engine.ts` (no imports) |
| Mobile copy (must stay byte-identical; the H5 test fails otherwise) | `apps/mobile/src/lib/pricingEngine.ts` |
| Engine self-test (85 cases) | `src/lib/pricing/engine-selftest.ts` (`npx tsx src/lib/pricing/engine-selftest.ts`) |
| Loader `loadPricingContext(db, tenantId, { customerId, posProfileId, at, couponCodes, itemIds })` | `src/lib/pricing/load-context.ts` |
| Catalog line resolver `resolvePricingLines(db, tenantId, lines)` (base price / uom factor from DB) | same file |
| `quoteCart` = both + `priceCart` | same file |
| Offline data `loadPricingBundle(db, tenantId)` | same file; served at `GET /api/price-quote/bundle` and as `pricing` in `GET /api/pos/offline-bundle` |
| Quote endpoint | `POST /api/price-quote` |
| Extra barcodes / unit conversions | `item_barcodes`, `item_uoms`, `units`; `src/lib/pricing/catalog.ts`; `PUT /api/items/[id]/uoms` (+ `barcodes`), `PUT /api/items/[id]/barcodes` |
| Columns already migrated (0161) | `sale_items.price_list_id, promotion_id, promotion_discount, promotions (jsonb), uom, uom_factor` (+ `list_price`, shared with 0157); `sales.promotion_discount, coupon_code`; `promotion_redemptions` |

Engine rules (stacking, priorities, tiers, schedules) are documented at the top of `engine.ts`.

## 1. Server: `POST /api/sales` (the authority)

The server recomputes list prices and promotions and never trusts client-side discounts that claim
to be promotions. Manual discounts keep their current path (`discount` per line / cart `discount`,
governed by `posProfiles.maxDiscountPercent` and approvals).

### 1.1 Request schema (`createSaleSchema`, `src/lib/validation/schemas/sales.ts`)

Add, all optional so old clients keep working:

```ts
// per cart line (cartItemSchema extension used by createSaleSchema)
uom: z.string().trim().max(20).optional(),          // unit sold; blank = base unit
priceLocked: z.boolean().optional(),                 // scale label / barcode price override / approved manual price
// sale level
couponCodes: z.array(z.string().trim().max(50)).max(5).optional(),
posProfileId: optionalUuid,                          // only as a hint; the shift's profile wins (below)
```

`quantity` stays in the line's unit (`uom`).

### 1.2 Where to call the engine

Right after the tenant-item check (`if (tenantItems.length !== new Set(itemIds).size ...)`, ~line 483)
and **before** the `expandedCartItems` loop (~line 508), skip for `isReturn` (returns are priced
from the original invoice) and for `workOrderId` / `restaurantOrderId` sales if those keep their own
prices:

```ts
import { loadPricingContext, resolvePricingLines, PricingLineError } from '@/lib/pricing/load-context'
import { priceCart } from '@/lib/pricing/engine'

const pricingProfileId = shiftCheck.shift?.posProfileId || governingProfile?.id || null   // the counter that sells
let pricing: ReturnType<typeof priceCart> | null = null
try {
  const lines = await resolvePricingLines(db, tenantId, cartItems.map((c, i) => ({
    key: String(i), itemId: c.itemId, quantity: c.quantity, uom: c.uom,
    unitPrice: c.unitPrice, priceLocked: c.priceLocked || !!c.scanLocked,
  })))
  const ctx = await loadPricingContext(db, tenantId, {
    customerId: customerId || null,
    posProfileId: pricingProfileId,
    couponCodes: parsed.data.couponCodes,
    itemIds: [...new Set(lines.map((l) => l.itemId))],
    // offline sales: price at the moment of sale, not upload
    at: isOfflineSale && parsed.data.soldAt ? new Date(parsed.data.soldAt) : undefined,
  })
  pricing = priceCart(ctx, lines)
} catch (e) {
  if (e instanceof PricingLineError) return NextResponse.json({ error: e.code === 'UOM_NOT_FOUND' ? `Item has no "${e.uom}" unit` : 'Invalid items in cart', code: e.code }, { status: 400 })
  throw e
}
```

(`governingProfile` / `shiftCheck` are computed earlier in the handler — move the pricing block below
them if needed; they exist before line 690.)

`priceLocked` must only be honoured when the line is legitimately fixed: a scale / GS1 price label
(the POS knows: `scanToLine(...).fixedAmount`), an `item_barcodes.price_override` scan, or a manual
price change that already goes through the existing `price_change` approval (`evaluateSaleControls`).
A locked line gets no price list but still gets promotions.

### 1.3 Inside the `expandedCartItems` loop (~line 508)

For each `cartItem` at `sourceIndex`, take `const p = pricing?.lines[sourceIndex]` and:

* `unitPrice`: if `p` exists, use `p.unitPrice` (server list price) **unless** the client sent a
  different price that is a manual override (`cartItem.unitPrice !== p.basePrice && cartItem.unitPrice !== p.unitPrice`):
  then keep the client price and let `evaluateSaleControls` judge it against `listPrice` as today.
* `listPrice` (existing field, written to `sale_items.list_price`): `p.basePrice` (catalog price of the unit
  sold — for a box that is `item_uoms.selling_price` or base × factor, not the per-piece price).
* new fields on `ExpandedCartItem`: `priceListId: p.priceListId`, `promotionDiscount: p.promotionDiscount`,
  `promotions: p.promotions.map(({promotionId,label,amount}) => ({promotionId,label,amount}))`,
  `promotionId: p.promotions[0]?.promotionId ?? null`, `uom: p.uom`, `uomFactor: p.uomFactor`,
  `cartPromotionShare: p.cartDiscountShare`.
* line `discount` = `roundCurrency(manualDiscount + p.promotionDiscount)` and
  `total = roundCurrency(unitPrice * quantity - discount)`. The "Discount exceeds item total" check
  then covers both.
* when `p.unitPrice` replaced the client's price, the offline `priceDifferences` flag compares against
  `p.unitPrice` (not `items.selling_price`).

### 1.4 Cart-level promotions and the totals check (~line 571)

`pricing.totals.cartDiscount` is a cart-level promotion amount. Add it to the sale discount:

```ts
const promotionCartDiscount = pricing?.totals.cartDiscount ?? 0
const finalDiscount = roundCurrency((discount || 0) + promotionCartDiscount)   // client `discount` = manual only
```

Client contract: the client sends `subtotal` = Σ line totals **after** line promotions (what
`/api/price-quote` returned as Σ `grossTotal − promotionDiscount`) and `discount` = manual cart
discount only. Accept for one release a client that already included the promotion in `discount`:
if `Math.abs(discount - promotionCartDiscount) < 0.01 && clientSentPromotions` treat it as included.
The existing `Cart total mismatch` check (±0.05) then validates the client's line totals against the
server-priced lines; a mismatch means the client priced with stale lists/promos → 400 with
`code: 'PRICE_CHANGED', quote: pricing` so the POS can show the new prices and resubmit (offline
sales: accept and record `saleFlags.priceDifferences` as today instead of rejecting).

`evaluateSaleControls` (~line 690) must receive the **manual** discount only (exclude
`promotionCartDiscount` and line `promotionDiscount`) so promotions never need supervisor approval
or count against `maxDiscountPercent`.

Tax: `discountRatio` (~line 581) uses `finalDiscount` — correct, promotions reduce the taxable value
(VAT on the amount actually charged). The `taxableLines` lineTotal already uses line totals net of
line promotions.

### 1.5 Writing the sale (~line 937 `tx.insert(sales)`, ~line 1184 `tx.insert(saleItems)`)

* `sales.promotion_discount` = `promotionCartDiscount`, `sales.coupon_code` = the first coupon code
  that produced a promotion (`pricing.appliedPromotions` ∩ coupon promos), `discountAmount` stays the
  total cart discount (manual + promotion) as today.
* `sale_items`: `priceListId`, `promotionId`, `promotionDiscount` (line-level only), `promotions`
  (jsonb array incl. the line's share of cart promotions as `{ promotionId, label, amount }` with
  `amount = share`), `uom`, `uomFactor: String(uomFactor)`, `listPrice` as above.
* Redemptions, in the same transaction, after the sale row exists:

```ts
for (const a of pricing?.appliedPromotions ?? []) {
  await tx.insert(promotionRedemptions).values({ tenantId, promotionId: a.promotionId, saleId: newSale.id, customerId: customerId || null, amount: String(a.amount) })
  // race-safe limit: the UPDATE fails to match when the limit was reached concurrently
  const [ok] = await tx.update(promotions)
    .set({ usageCount: sql`${promotions.usageCount} + 1` })
    .where(and(eq(promotions.id, a.promotionId), or(isNull(promotions.usageLimit), lt(promotions.usageCount, promotions.usageLimit))))
    .returning({ id: promotions.id })
  if (!ok && !isOfflineSale) throw new PromotionExhaustedError(a.promotionId)   // → 409, POS re-quotes
}
```

  Per-customer limits: `loadPricingContext` already counts `promotion_redemptions` of the customer;
  under concurrency take `pg_advisory_xact_lock(hashtext('promo:'||promotionId||':'||customerId))`
  before counting when `perCustomerLimit` is set.
* Void (`PUT /api/sales/[id]` void path): `UPDATE promotion_redemptions SET voided_at = now()` for the
  sale and decrement `promotions.usage_count` (floor 0). Returns do not give back usage.

### 1.6 Stock in base units (~line 1224 `stockInputs.push`)

`quantity` on the line is in `uom`; stock is always in the base unit:

```ts
const baseQty = roundQty(cartItem.quantity * (cartItem.uomFactor || 1))   // 3 decimals
stockInputs.push({ ..., qty: -baseQty, ... })
```

Apply the same factor to: reservation checks (`reservedMap` comparisons), batch allocation
(`batchLines` → FEFO draws `baseQty`), serial-number count checks (serial items should only be
sold in their base unit — reject `uomFactor !== 1` with serials), cost of goods
(`costPrice` is per base unit → COGS = `costPrice × baseQty`), and the stock-shortfall flags.
Returns (`src/lib/sales/returns.ts`): `returnedQuantity` stays in the line's uom; the stock put back
is `returnQty × sale_items.uom_factor`.

Held sales / layaways / sales orders store cart JSON — add `uom`/`uomFactor` to their line objects
when the POS sends them; the held-sales reservation sum (`items` GET, `reservedMap`) must multiply
by `uomFactor`.

## 2. Web POS (`src/app/c/[slug]/pos/**`, `src/components/pos/**`)

1. Load prices: on cart change (debounced 300 ms), customer change, coupon entry, call
   `POST /api/price-quote` with `{ customerId, posProfileId, couponCodes, lines: cart.map(l => ({ key: l.id, itemId, quantity, uom, unitPrice, priceLocked })) }`.
   Show `lines[i].unitPrice` as the price (strike through `basePrice` when lower and show
   `priceListName`), each `promotions[j].label` + amount under the line, cart promotions as discount
   rows above the total (`cartPromotions`). Totals come from `totals`.
2. Send to `/api/sales`: `unitPrice = quote.unitPrice`, line `discount` = manual line discount only,
   `subtotal = Σ (grossTotal − promotionDiscount − manualDiscount)`, `discount` = manual cart
   discount, `couponCodes`, `uom`, `priceLocked`. Handle `PRICE_CHANGED` (re-quote, show diff,
   resubmit) and the promotion-exhausted 409.
3. Scanning: `GET /api/items/barcode-lookup` now returns `uom`, `uomFactor`, `packQty`, `uomPrice`,
   `productType`, and `scan.matchedBy` = `item_barcode` | `uom_barcode`. A uom-aware cart adds
   `packQty` of `uom` at `uomPrice` (`priceLocked` when `item_barcodes.price_override` was used —
   detectable as `uomPrice !== price of that unit`). Until then the response already expresses the
   scan in base units (`scan.quantity` / `scan.unitPrice` / `scan.lineTotal`), which the current
   cart handles correctly (stock and amount right; shows "12 pcs" instead of "1 box").
4. Unit picker on a line: units come from `GET /api/items/[id]/uoms` (or the bundle's `itemUoms`);
   changing the unit re-quotes.
5. Coupon field on the tender screen → `couponCodes`.
6. Receipts: print `promotions[].label` and amounts per line, cart promotions as discount lines, and
   `uom` next to quantity (`1 box`). (Receipt templates are owned by the Tax/receipt agent: they read
   `sale_items.promotions`, `sale_items.uom`, `sales.promotion_discount`.)

## 3. Mobile POS (`apps/mobile/app/pos.tsx`, `TenderModal.tsx`, `CartDrawerModal.tsx`)

* Online: same as the web POS through `POST /api/price-quote`.
* Offline: the cached bundle (`getBundle().pricing`, already downloaded by `refreshBundle()`) has
  `priceLists`, `promotions`, `itemUoms`, `itemBarcodes`, `timezone`. Run the shared engine:

```ts
import { priceCart, localClock } from '../src/lib/pricingEngine'
const p = bundle.pricing
const result = priceCart({
  now: localClock(new Date(), p.timezone),
  customerId, customerType,            // customerType from the local customer cache / sale picker
  posProfileId: bundle.posProfile?.id ?? null,
  couponCodes,
  priceLists: p.priceLists,
  promotions: p.promotions,            // per-customer usage is unknown offline: the server re-checks on sync
}, cart.map((l, i) => ({
  key: l.id, itemId: l.itemId, categoryId: l.categoryId, quantity: l.quantity,
  uom: l.uom ?? null, uomFactor: l.uomFactor ?? 1,
  basePrice: l.uom ? uomPrice(l) : Number(l.sellingPrice),
  priceLocked: !!l.fixedAmount, excludeFromPromotions: l.isGiftCard,
})))
```

* `findByCode` (`apps/mobile/src/lib/localdb.ts`) already resolves additional and unit barcodes from
  the bundle (`apps/mobile/src/lib/catalogUnits.ts`) and returns `uom`, `uomFactor`, `packQty`,
  `uomPrice` plus base-unit `quantity` / `unitPrice` / `lineTotal` (current behaviour of `pos.tsx`
  stays correct).
* `cartMath.ts`: `lineTotal = round2(round2(unitPrice) × quantity − discount)` must use the engine's
  `unitPrice` and `discount = manual + promotionDiscount`; `cartPayable` subtracts
  `totals.cartDiscount`. Queue the sale with the same fields as the web POS plus `uom`.
* Local stock (`adjustLocalStock`, `pendingStock.ts`): subtract `quantity × uomFactor`.

## 4. Order of work / tests

1. Schema fields + server engine call + base-unit stock (sales route, returns, held-sales reservation).
2. Extend `scripts/tests/gA-sales.ts`: wholesale customer gets list price; BOGO line discount stored
   on `sale_items.promotion_discount`; coupon cart promo in `sales.promotion_discount`; usage_count
   increments and voiding decrements; box sale deducts 12 pcs of stock; client-claimed promotion
   discount without a promotion is rejected (`Cart total mismatch`); promotions do not trigger
   `APPROVAL_REQUIRED`.
3. Web POS, then mobile POS (offline engine + queue fields).
4. Reports: promotion effectiveness = `promotion_redemptions` joined to sales (not built).

## Known limits (by design, documented in `engine.ts`)

* Stacking is per line: a non-stackable buy-X-get-Y locks its whole qualifying lines even when only
  some units were needed.
* Buy X get Y / bundles count whole units only (weighed lines never qualify).
* Changing an item's base unit (`items.unit`) does not rescale its conversions or price-list rules.
* Offline devices cannot enforce per-customer limits exactly; the server re-validates on upload and
  flags differences.
