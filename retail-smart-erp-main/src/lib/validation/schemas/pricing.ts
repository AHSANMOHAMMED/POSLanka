import { z } from 'zod'
import { uuidSchema, optionalUuid, optionalDateString, paginatedSearchSchema, percentageSchema } from './common'

// H5: price lists, promotions, units of measure, extra barcodes (drizzle/0161_pricing_catalog.sql)

const unitCode = z.string().trim().min(1, 'Unit is required').max(20).transform((v) => v.toLowerCase())
const optionalUnitCode = z.string().trim().max(20).optional().transform((v) => (v ? v.toLowerCase() : undefined))
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be in HH:MM format').optional()
const money = z.coerce.number().min(0, 'Amount cannot be negative')
const customerTypeValues = ['retail', 'wholesale', 'vip'] as const // schema.ts: customerTypeEnum

// ==================== UNITS ====================

export const createUnitSchema = z.object({
  code: unitCode,
  name: z.string().trim().min(1, 'Name is required').max(50),
  allowFraction: z.boolean().optional(),
})

export const updateUnitSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  allowFraction: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

// ==================== ITEM BARCODES / UOMS ====================

const itemBarcodesArray = z.array(z.object({
    barcode: z.string().trim().min(1, 'Barcode is required').max(100),
    uom: optionalUnitCode,
    packQty: z.coerce.number().positive('Pack quantity must be greater than zero').optional(),
    priceOverride: money.optional(),
    label: z.string().trim().max(100).optional(),
  })).max(100, 'Maximum 100 barcodes per item')

// PUT /api/items/[id]/barcodes — replaces the item's additional barcodes
export const replaceItemBarcodesSchema = z.object({
  barcodes: itemBarcodesArray,
})

// PUT /api/items/[id]/uoms — replaces the item's unit conversions
export const replaceItemUomsSchema = z.object({
  uoms: z.array(z.object({
    uom: unitCode,
    factor: z.coerce.number().positive('Conversion factor must be greater than zero').max(1_000_000),
    barcode: z.string().trim().max(100).optional(),
    sellingPrice: money.optional(),
    isActive: z.boolean().optional(),
  })).max(50, 'Maximum 50 units per item'),
  /** optional: replace the barcodes in the same transaction (lets a form drop a unit and its barcode together) */
  barcodes: itemBarcodesArray.optional(),
})

// ==================== PRICE LISTS ====================

export const priceListsListSchema = paginatedSearchSchema.extend({
  includeInactive: z.string().optional().transform((v) => v === 'true'),
})

const priceListBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  priority: z.coerce.number().int().min(-1000).max(1000).optional(),
  isActive: z.boolean().optional(),
  validFrom: optionalDateString,
  validTo: optionalDateString,
  appliesTo: z.enum(['all', 'customer_group', 'customers', 'pos_profiles']).default('all'),
  customerTypes: z.array(z.enum(customerTypeValues)).max(10).optional(),
  customerIds: z.array(uuidSchema).max(1000).optional(),
  posProfileIds: z.array(uuidSchema).max(200).optional(),
  notes: z.string().max(2000).optional(),
})

function priceListRefine<T extends z.infer<typeof priceListBase>>(v: T, ctx: z.RefinementCtx) {
  if (v.validFrom && v.validTo && v.validFrom > v.validTo) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Valid to must be on or after valid from' })
  }
  if (v.appliesTo === 'customer_group' && !(v.customerTypes && v.customerTypes.length)) {
    ctx.addIssue({ code: 'custom', path: ['customerTypes'], message: 'Choose at least one customer group' })
  }
  if (v.appliesTo === 'customers' && !(v.customerIds && v.customerIds.length)) {
    ctx.addIssue({ code: 'custom', path: ['customerIds'], message: 'Choose at least one customer' })
  }
  if (v.appliesTo === 'pos_profiles' && !(v.posProfileIds && v.posProfileIds.length)) {
    ctx.addIssue({ code: 'custom', path: ['posProfileIds'], message: 'Choose at least one POS profile' })
  }
}

export const createPriceListSchema = priceListBase.superRefine(priceListRefine)
export const updatePriceListSchema = priceListBase.superRefine(priceListRefine)

// One row: item by id, or by item code / barcode / SKU (CSV import). price XOR discountPercent.
export const priceListItemRowSchema = z.object({
  itemId: optionalUuid,
  itemCode: z.string().trim().max(100).optional(),
  uom: optionalUnitCode,
  minQty: z.coerce.number().min(0).optional(),
  price: money.optional(),
  discountPercent: percentageSchema.optional(),
}).superRefine((v, ctx) => {
  if (!v.itemId && !v.itemCode) ctx.addIssue({ code: 'custom', path: ['itemId'], message: 'Item is required' })
  if ((v.price === undefined) === (v.discountPercent === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'Give either a price or a discount %' })
  }
})

// PUT /api/price-lists/[id]/items — mode 'replace' (default) swaps the whole list, 'merge' upserts rows
export const savePriceListItemsSchema = z.object({
  mode: z.enum(['replace', 'merge']).default('replace'),
  items: z.array(priceListItemRowSchema).max(10000, 'Maximum 10,000 rows per request'),
})

// ==================== PROMOTIONS ====================

export const promotionTypeValues = ['percent_off', 'fixed_off', 'buy_x_get_y', 'bundle_price', 'min_spend'] as const

export const promotionsListSchema = paginatedSearchSchema.extend({
  includeInactive: z.string().optional().transform((v) => v === 'true'),
})

const promotionBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  description: z.string().max(2000).optional(),
  type: z.enum(promotionTypeValues),
  applyTo: z.enum(['items', 'categories', 'cart']).default('items'),
  discountType: z.enum(['percent', 'fixed']).default('percent'),
  value: money.default(0),
  itemIds: z.array(uuidSchema).max(1000).optional(),
  categoryIds: z.array(uuidSchema).max(200).optional(),
  buyQty: z.coerce.number().int().positive().optional(),
  getQty: z.coerce.number().int().positive().optional(),
  getItemIds: z.array(uuidSchema).max(1000).optional(),
  getDiscountPercent: percentageSchema.optional(),
  bundleItems: z.array(z.object({ itemId: uuidSchema, qty: z.coerce.number().int().positive() })).max(20).optional(),
  bundlePrice: money.optional(),
  minSpend: money.optional(),
  startsOn: optionalDateString,
  endsOn: optionalDateString,
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
  timeFrom: timeOfDay,
  timeTo: timeOfDay,
  posProfileIds: z.array(uuidSchema).max(200).optional(),
  customerTypes: z.array(z.enum(customerTypeValues)).max(10).optional(),
  priority: z.coerce.number().int().min(-1000).max(1000).optional(),
  stackable: z.boolean().optional(),
  couponCode: z.string().trim().max(50).regex(/^[A-Za-z0-9_-]*$/, 'Coupon code: letters, digits, - and _ only').optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  usageLimit: z.coerce.number().int().positive().optional(),
  perCustomerLimit: z.coerce.number().int().positive().optional(),
  isActive: z.boolean().optional(),
})

function promotionRefine<T extends z.infer<typeof promotionBase>>(v: T, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (v.startsOn && v.endsOn && v.startsOn > v.endsOn) issue('endsOn', 'End date must be on or after start date')
  if ((v.timeFrom && !v.timeTo) || (!v.timeFrom && v.timeTo)) issue('timeTo', 'Give both a start and an end time')
  if (v.timeFrom && v.timeTo && v.timeFrom.slice(0, 5) === v.timeTo.slice(0, 5)) issue('timeTo', 'Start and end time must differ')
  const targets = (v.itemIds?.length || 0) + (v.categoryIds?.length || 0)
  switch (v.type) {
    case 'percent_off':
    case 'fixed_off':
      if (!(v.value > 0)) issue('value', 'Discount must be greater than zero')
      if (v.type === 'percent_off' && v.value > 100) issue('value', 'Percentage cannot exceed 100')
      if (v.applyTo === 'items' && !v.itemIds?.length) issue('itemIds', 'Choose at least one item')
      if (v.applyTo === 'categories' && !v.categoryIds?.length) issue('categoryIds', 'Choose at least one category')
      break
    case 'buy_x_get_y':
      if (!v.buyQty) issue('buyQty', 'Buy quantity is required')
      if (!v.getQty) issue('getQty', 'Get quantity is required')
      if (targets === 0) issue('itemIds', 'Choose the items (or categories) to buy')
      break
    case 'bundle_price':
      if (!v.bundleItems || v.bundleItems.length < 2) issue('bundleItems', 'A bundle needs at least two items')
      if (v.bundlePrice === undefined) issue('bundlePrice', 'Bundle price is required')
      break
    case 'min_spend':
      if (!(v.minSpend && v.minSpend > 0)) issue('minSpend', 'Minimum spend is required')
      if (!(v.value > 0)) issue('value', 'Discount must be greater than zero')
      if (v.discountType === 'percent' && v.value > 100) issue('value', 'Percentage cannot exceed 100')
      break
  }
}

export const createPromotionSchema = promotionBase.superRefine(promotionRefine)
export const updatePromotionSchema = promotionBase.superRefine(promotionRefine)

// ==================== PRICE QUOTE ====================

// POST /api/price-quote
export const priceQuoteSchema = z.object({
  customerId: optionalUuid,
  posProfileId: optionalUuid,
  couponCodes: z.array(z.string().trim().max(50)).max(5).optional(),
  /** ISO instant to price at (default now); only managers may price the past/future */
  at: z.string().datetime().optional(),
  lines: z.array(z.object({
    key: z.string().max(100).optional(),
    itemId: uuidSchema,
    quantity: z.coerce.number().refine((q) => q !== 0 && Math.abs(q) <= 1_000_000, 'Invalid quantity'),
    uom: z.string().trim().max(20).optional(),
    unitPrice: z.coerce.number().min(0).optional(),
    priceLocked: z.boolean().optional(),
  })).min(1, 'Cart cannot be empty').max(500, 'Maximum 500 lines'),
})
