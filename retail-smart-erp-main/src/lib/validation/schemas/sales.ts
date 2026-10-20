import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  cartItemSchema, paymentMethodSchema, discountTypeSchema,
  salesOrderStatusSchema, optimisticLockSchema,
} from './common'

// ==================== SALES ====================

// GET /api/sales
export const salesListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
  customerId: z.string().uuid().optional(),
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
  notes: z.string().max(500).optional(),
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
  refundMethod: z.enum(['cash', 'card', 'credit']).optional(),
  warehouseId: optionalUuid,
  posOpeningEntryId: optionalUuid,
  costCenterId: optionalUuid,
  loyaltyPointsRedeemed: z.coerce.number().int().min(0).optional(),
  workOrderId: optionalUuid,
  restaurantOrderId: optionalUuid,
  tipAmount: z.coerce.number().min(0).optional(),
  giftCardId: optionalUuid,
  /** Offline sync idempotency key */
  clientSaleId: z.string().uuid().optional(),
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
  voidReason: z.string().max(1000).optional(),
})

// POST /api/sales/[id]/payments
export const addSalePaymentSchema = z.object({
  amount: z.coerce.number().min(0, 'Amount cannot be negative').default(0),
  method: paymentMethodSchema.default('cash'),
  reference: z.string().max(255).optional(),
  creditAmount: z.coerce.number().min(0).default(0),
  addOverpaymentToCredit: z.boolean().optional().default(false),
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
