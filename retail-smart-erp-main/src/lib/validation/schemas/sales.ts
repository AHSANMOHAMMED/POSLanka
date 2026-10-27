import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  cartItemSchema, paymentMethodSchema, discountTypeSchema,
  salesOrderStatusSchema, optimisticLockSchema,
} from './common'
import { prescriptionInputSchema } from './pharmacy'
import { chequeDetailsSchema } from './cheques'

// ==================== SALES ====================

// GET /api/sales
export const salesListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
  customerId: z.string().uuid().optional(),
  /** Sales (and returns) of one POS shift */
  posOpeningEntryId: z.string().uuid().optional(),
})

// Tax breakdown item schema (per-component tax detail)
const taxBreakdownItemSchema = z.object({
  taxName: z.string().max(100),
  rate: z.coerce.number().min(0),
  amount: z.coerce.number(),
  accountId: z.string().uuid().nullable().optional(),
  includedInPrice: z.boolean(),
})

// POST /api/sales - cart item with sales-specific fields
const saleCartItemSchema = cartItemSchema.extend({
  itemId: z.string().uuid().optional(), // Optional for returns of deleted items
  name: z.string().max(255),
  sku: z.string().max(100).optional(),
  quantity: z.coerce.number().refine(v => v !== 0, 'Quantity cannot be zero'),
  unitPrice: z.coerce.number(),
  discount: z.coerce.number().min(0).default(0),
  discountType: discountTypeSchema.optional(),
  taxRate: z.coerce.number().min(0).optional(),
  taxTemplateId: z.string().uuid().optional(),
  taxBreakdown: z.array(taxBreakdownItemSchema).optional(),
  taxAmount: z.coerce.number().min(0).optional(),
  serialNumberIds: z.array(uuidSchema).optional(),
  batchId: optionalUuid,
  /** D1: batch number (e.g. GS1 AI 10 from a scan), resolved to a batch of the item */
  batchNumber: z.string().trim().max(100).optional(),
  notes: z.string().max(500).optional(),
  /** Returns: the original sale line being returned (W8). */
  originalSaleItemId: optionalUuid,
  /** H5: unit sold (item_uoms.uom); quantity is in this unit, stock moves quantity × factor base units */
  uom: z.string().trim().max(20).optional(),
  /** H5: price fixed on the device (scale / GS1 label amount, barcode price override): no price list */
  priceLocked: z.boolean().optional(),
  /** H5: additional barcode the line was scanned with — its price override counts as the resolved price */
  barcode: z.string().trim().max(100).optional(),
})

const paymentSplitSchema = z.object({
  method: paymentMethodSchema,
  amount: z.coerce.number().positive(),
  reference: z.string().max(100).optional(),
})

export const createSaleSchema = z.object({
  customerId: optionalUuid,
  vehicleId: optionalUuid,
  customerName: z.string().max(255).optional(),
  vehiclePlate: z.string().max(50).optional(),
  vehicleDescription: z.string().max(500).optional(),
  cartItems: z.array(saleCartItemSchema).min(1, 'Cart cannot be empty').max(200, 'Maximum 200 items'),
  paymentMethod: paymentMethodSchema.optional(),
  /** Split tender at POS — when present, overrides single paymentMethod for payment rows */
  paymentSplits: z.array(paymentSplitSchema).max(10).optional(),
  /** Negative for returns (cart lines carry negative quantities); must be >= 0 for sales — enforced below */
  subtotal: z.coerce.number(),
  discount: z.coerce.number().min(0).default(0),
  discountType: discountTypeSchema.optional(),
  discountReason: z.string().max(500).optional(),
  tax: z.coerce.number().default(0),
  taxRate: z.coerce.number().min(0).optional(),
  taxInclusive: z.boolean().optional(),
  taxBreakdown: z.array(taxBreakdownItemSchema).optional(),
  total: z.coerce.number(),
  amountPaid: z.coerce.number().min(0).optional(),
  creditAmount: z.coerce.number().min(0).default(0),
  addOverpaymentToCredit: z.boolean().optional(),
  isReturn: z.boolean().default(false),
  returnAgainst: optionalUuid,
  refundAmount: z.coerce.number().min(0).optional(),
  refundMethod: z.enum(['cash', 'card', 'credit', 'original']).optional(),
  warehouseId: optionalUuid,
  posOpeningEntryId: optionalUuid,
  costCenterId: optionalUuid,
  loyaltyPointsRedeemed: z.coerce.number().int().min(0).optional(),
  workOrderId: optionalUuid,
  restaurantOrderId: optionalUuid,
  tipAmount: z.coerce.number().min(0).optional(),
  giftCardId: optionalUuid,
  /** Quotation the cart was loaded from (POS ?fromQuotation): linked as converted to this sale */
  quotationId: optionalUuid,
  /** Offline sync idempotency key */
  clientSaleId: z.string().uuid().optional(),
  /** Receipt number printed while offline ('OFF-<device>-<seq>'), unique per tenant */
  offlineRef: z.string().trim().min(1).max(40).optional(),
  /**
   * D2: the receipt number actually printed when `offlineRef` had to be changed after an
   * OFFLINE_REF_CONFLICT; stored in sales.flags.offlineRefAlias so lookups by the printed number work.
   */
  offlineRefAlias: z.string().trim().min(1).max(40).optional(),
  /** Pharmacy: prescription for prescription / controlled medicines in the cart (src/lib/pharmacy) */
  prescription: prescriptionInputSchema.optional(),
  /** K1: details of the cheque taken when paymentMethod (or one split) is 'cheque' */
  cheque: chequeDetailsSchema.optional(),
  /** Returns: reason code (required for returns without an original invoice) */
  returnReason: z.string().trim().max(50).optional(),
  returnNotes: z.string().max(1000).optional(),
  /**
   * H1: supervisor approvals (POST /api/auth/verify-pin → approvalToken) for a discount above the
   * counter's limit, a price below the catalog on a counter without rate changes, or a credit sale
   * beyond the customer's credit limit. Without them such a sale is rejected (403 APPROVAL_REQUIRED).
   */
  approvalTokens: z.array(z.string().max(2000)).max(10).optional(),
  /** H5: coupon codes entered at the till */
  couponCodes: z.array(z.string().trim().max(50)).max(5).optional(),
  /**
   * H5: cart-level promotion discount the client applied (NOT part of `discount`, which is the
   * manual cart discount). The server recomputes it; online a difference → 409 PRICE_CHANGED.
   */
  promotionDiscount: z.coerce.number().min(0).optional(),
  /** H5: when an offline sale was rung up (prices / promotion schedules are evaluated then) */
  soldAt: z.string().datetime().optional(),
}).superRefine((data, ctx) => {
  if (!data.isReturn) {
    if (data.subtotal < 0) ctx.addIssue({ code: 'custom', path: ['subtotal'], message: 'Subtotal cannot be negative' })
    if (data.tax < 0) ctx.addIssue({ code: 'custom', path: ['tax'], message: 'Tax cannot be negative' })
    if (data.total < 0) ctx.addIssue({ code: 'custom', path: ['total'], message: 'Total cannot be negative' })
  }
})

// ==================== SALES ORDERS ====================

// GET /api/sales-orders
export const salesOrdersListSchema = paginatedSearchSchema.extend({
  status: salesOrderStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'orderNo', 'status', 'total']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

const salesOrderItemSchema = z.object({
  itemId: optionalUuid,
  itemName: z.string().max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).default(0),
  discountType: discountTypeSchema.optional(),
  tax: z.coerce.number().min(0).optional(),
  taxAmount: z.coerce.number().min(0).optional(),
  taxRate: z.coerce.number().min(0).optional(),
  /** 0184: unit the line is entered in (blank = base unit); the factor is resolved server-side */
  uom: z.string().trim().max(20).nullish(),
})

// POST /api/sales-orders
export const createSalesOrderSchema = z.object({
  customerId: optionalUuid,
  customerName: z.string().max(255).optional(),
  vehicleId: optionalUuid,
  vehiclePlate: z.string().max(50).optional(),
  vehicleDescription: z.string().max(500).optional(),
  warehouseId: uuidSchema,
  expectedDeliveryDate: z.string().optional(),
  deliveryAddress: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(salesOrderItemSchema).optional(),
})

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/sales/[id] - void a sale
export const voidSaleSchema = z.object({
  voidReason: z.string().trim().min(1, 'A void reason is required').max(1000),
})

// POST /api/sales/[id]/payments
export const addSalePaymentSchema = z.object({
  amount: z.coerce.number().min(0, 'Amount cannot be negative').default(0),
  method: paymentMethodSchema.default('cash'),
  reference: z.string().max(255).optional(),
  creditAmount: z.coerce.number().min(0).default(0),
  addOverpaymentToCredit: z.boolean().optional().default(false),
  /** K1: cheque details when method is 'cheque' */
  cheque: chequeDetailsSchema.optional(),
})

// PUT /api/sales-orders/[id]
export const updateSalesOrderSchema = z.object({
  customerId: optionalUuid,
  customerName: z.string().max(255).nullish(),
  vehicleId: optionalUuid,
  vehiclePlate: z.string().max(50).nullish(),
  vehicleDescription: z.string().max(500).nullish(),
  warehouseId: z.string().uuid().optional(),
  expectedDeliveryDate: z.string().nullish(),
  deliveryAddress: z.string().max(500).nullish(),
  notes: z.string().max(2000).nullish(),
  status: salesOrderStatusSchema.optional(),
  cancellationReason: z.string().max(1000).optional(),
  items: z.array(salesOrderItemSchema.extend({
    id: z.string().uuid().optional(),
  })).optional(),
  changesSummary: z.string().max(2000).optional(),
}).merge(optimisticLockSchema)

// POST /api/sales-orders/[id]/create-invoice
export const createSalesInvoiceSchema = z.object({
  fulfilledQuantities: z.record(z.string().uuid(), z.coerce.number().min(0)).optional(),
  notes: z.string().max(2000).optional(),
  costCenterId: optionalUuid,
})

// ==================== W8: RETURNS / EXCHANGE / LOOKUP ====================

// GET /api/sales/lookup?code=INV-000123 | RTN-000004 | OFF-DEV1-17
export const salesLookupSchema = z.object({
  code: z.string().trim().min(1).max(60),
})

const returnLineSchema = z.object({
  originalSaleItemId: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  serialNumberIds: z.array(uuidSchema).optional(),
})

// POST /api/sales/exchange
export const exchangeSaleSchema = z.object({
  originalSaleId: z.string().uuid(),
  returnLines: z.array(returnLineSchema).min(1, 'Select at least one line to return').max(200),
  newCartItems: z.array(saleCartItemSchema).min(1, 'Add at least one new item').max(200),
  paymentMethod: paymentMethodSchema.optional(),
  paymentSplits: z.array(paymentSplitSchema).max(10).optional(),
  /** Money received from the customer when the new sale costs more than the refund */
  amountPaid: z.coerce.number().min(0).optional(),
  /** How the difference is paid back when the refund is larger than the new sale */
  refundMethod: z.enum(['cash', 'card', 'credit']).optional(),
  warehouseId: optionalUuid,
  posOpeningEntryId: optionalUuid,
  customerId: optionalUuid,
  clientSaleId: z.string().uuid().optional(),
  reason: z.string().trim().max(50).optional(),
  notes: z.string().max(1000).optional(),
  /** H1: supervisor approvals for discounts / prices below catalog on the new items */
  approvalTokens: z.array(z.string().max(2000)).max(10).optional(),
})

// POST /api/sales/[id]/remove-lines
export const removeSaleLinesSchema = z.object({
  lines: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantity: z.coerce.number().positive('Quantity must be greater than zero'),
    serialNumberIds: z.array(uuidSchema).optional(),
  })).min(1).max(200),
  reason: z.string().trim().min(1, 'A reason is required').max(50),
  notes: z.string().max(1000).optional(),
  refundMethod: z.enum(['cash', 'card', 'credit', 'original']).default('cash'),
  refundAmount: z.coerce.number().min(0).optional(),
  posOpeningEntryId: optionalUuid,
})
