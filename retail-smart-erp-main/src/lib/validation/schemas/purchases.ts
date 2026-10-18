import { z } from 'zod'
import {
  uuidSchema, optionalUuid, paginatedSearchSchema,
  purchaseStatusSchema, purchaseOrderStatusSchema,
  purchaseRequisitionStatusSchema, supplierQuotationStatusSchema,
  purchaseReceiptStatusSchema, sortOrderSchema, optimisticLockSchema,
  paymentMethodSchema,
} from './common'

// ==================== SHARED PURCHASE ITEM SCHEMAS ====================

/** Item for purchases and purchase orders */
const purchaseItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  tax: z.coerce.number().min(0).optional(),
})

// ==================== PURCHASES (Purchase Invoices) ====================

// GET /api/purchases
export const purchasesListSchema = paginatedSearchSchema.extend({
  status: purchaseStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'purchaseNo', 'status', 'total', 'supplierName']).default('createdAt'),
  sortOrder: sortOrderSchema,
})

// POST /api/purchases
export const createPurchaseSchema = z.object({
  supplierId: uuidSchema,
  warehouseId: uuidSchema,
  purchaseOrderId: optionalUuid,
  supplierInvoiceNo: z.string().max(100).optional(),
  supplierBillDate: z.string().optional(),
  paymentTerm: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  costCenterId: optionalUuid,
  items: z.array(purchaseItemSchema).max(500, 'Maximum 500 items').optional(),
})

// ==================== PURCHASE ORDERS ====================

// GET /api/purchase-orders
export const purchaseOrdersListSchema = paginatedSearchSchema.extend({
  status: purchaseOrderStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'orderNo', 'status', 'total', 'supplierName']).default('createdAt'),
  sortOrder: sortOrderSchema,
})

// POST /api/purchase-orders
export const createPurchaseOrderSchema = z.object({
  supplierId: uuidSchema,
  warehouseId: uuidSchema,
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  items: z.array(purchaseItemSchema).optional(),
})

// POST /api/purchase-orders/bulk-action
const bulkActionValues = ['submit', 'confirm', 'cancel', 'delete'] as const
export const purchaseOrderBulkActionSchema = z.object({
  action: z.enum(bulkActionValues),
  orderIds: z.array(uuidSchema).min(1, 'At least one order is required').max(100, 'Maximum 100 orders per batch'),
  cancellationReason: z.string().max(1000).optional(),
})

// ==================== PURCHASE REQUISITIONS ====================

// GET /api/purchase-requisitions
export const purchaseRequisitionsListSchema = paginatedSearchSchema.extend({
  status: purchaseRequisitionStatusSchema.optional(),
  sortBy: z.enum(['createdAt', 'requisitionNo', 'status', 'estimatedTotal', 'requiredByDate']).default('createdAt'),
  sortOrder: sortOrderSchema,
})

/** Item for purchase requisitions */
const requisitionItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  estimatedUnitPrice: z.coerce.number().min(0).optional(),
  preferredSupplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
})

// POST /api/purchase-requisitions
export const createPurchaseRequisitionSchema = z.object({
  department: z.string().max(100).optional(),
  costCenterId: optionalUuid,
  requiredByDate: z.string().optional(),
  purpose: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(requisitionItemSchema).optional(),
})

// POST /api/purchase-requisitions/[id]/approve
export const approveRequisitionSchema = z.object({
  approvalNotes: z.string().max(1000).optional(),
}).optional().default({})

// POST /api/purchase-requisitions/[id]/reject
export const rejectRequisitionSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Rejection reason is required').max(1000),
})

// POST /api/purchase-requisitions/[id]/convert-to-po
export const convertRequisitionToPOSchema = z.object({
  supplierId: uuidSchema,
  warehouseId: uuidSchema,
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  itemIds: z.array(uuidSchema).optional(),
})

// PUT /api/purchase-requisitions/[id]/items (bulk update)
const updateRequisitionItemEntrySchema = z.object({
  id: uuidSchema,
  quantity: z.coerce.number().positive().optional(),
  estimatedUnitPrice: z.coerce.number().min(0).optional(),
  preferredSupplierId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  notes: z.string().max(500).nullish(),
})

export const updateRequisitionItemsSchema = z.array(updateRequisitionItemEntrySchema).min(1, 'At least one item is required')

// POST /api/purchase-requisitions/[id]/items
export const addRequisitionItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  estimatedUnitPrice: z.coerce.number().min(0).optional(),
  preferredSupplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
})

// ==================== SUPPLIER QUOTATIONS ====================

// GET /api/supplier-quotations
export const supplierQuotationsListSchema = paginatedSearchSchema.extend({
  status: supplierQuotationStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'quotationNo', 'status', 'total', 'supplierName']).default('createdAt'),
  sortOrder: sortOrderSchema,
})

/** Item for supplier quotations */
const quotationItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
})

// POST /api/supplier-quotations
export const createSupplierQuotationSchema = z.object({
  supplierId: uuidSchema,
  requisitionId: optionalUuid,
  validUntil: z.string().optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  paymentTerms: z.string().max(200).optional(),
  supplierReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(quotationItemSchema).optional(),
})

// POST /api/supplier-quotations/[id]/convert-to-po
export const convertQuotationToPOSchema = z.object({
  warehouseId: uuidSchema,
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

// POST /api/supplier-quotations/[id]/items
export const addQuotationItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
})

// ==================== PURCHASE RECEIPTS ====================

// GET /api/purchase-receipts
export const purchaseReceiptsListSchema = paginatedSearchSchema.extend({
  status: purchaseReceiptStatusSchema.optional(),
  purchaseOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
})

// ==================== DETAIL / ACTION SCHEMAS ====================

// PUT /api/purchases/[id] - update purchase (edit draft, submit, or cancel)
export const updatePurchaseSchema = z.object({
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  supplierInvoiceNo: z.string().max(100).optional(),
  supplierBillDate: z.string().optional(),
  paymentTerm: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  costCenterId: optionalUuid,
  status: z.enum(['pending', 'cancelled']).optional(),
  cancellationReason: z.string().max(1000).optional(),
  itemSerials: z.record(z.string(), z.string()).optional(),
  changesSummary: z.string().max(2000).optional(),
}).merge(optimisticLockSchema)

// POST /api/purchases/[id]/items
export const addPurchaseItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  tax: z.coerce.number().min(0).optional(),
})

// PUT /api/purchases/[id]/items/[itemId]
export const updatePurchaseItemSchema = z.object({
  quantity: z.coerce.number().positive('Quantity must be greater than zero').optional(),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').optional(),
  tax: z.coerce.number().min(0).optional(),
})

// POST /api/purchases/[id]/payments
export const addPurchasePaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  paymentMethod: paymentMethodSchema.default('cash'),
  paymentReference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
})

// POST /api/purchases/[id]/return
const purchaseReturnItemSchema = z.object({
  purchaseItemId: uuidSchema,
  returnQuantity: z.coerce.number().positive('Return quantity must be greater than zero'),
})
export const createPurchaseReturnSchema = z.object({
  items: z.array(purchaseReturnItemSchema).min(1, 'At least one item is required').max(200),
  reason: z.string().max(1000).optional(),
  returnReason: z.string().max(1000).optional(),
})

// PUT /api/purchase-orders/[id]
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  status: purchaseOrderStatusSchema.optional(),
  cancellationReason: z.string().max(1000).optional(),
  items: z.array(purchaseItemSchema.extend({
    id: z.string().uuid().optional(),
  })).optional(),
  changesSummary: z.string().max(2000).optional(),
}).merge(optimisticLockSchema)

// PUT /api/purchase-orders/[id]/items/[itemId]
export const updatePurchaseOrderItemSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemName: z.string().trim().min(1).max(255).optional(),
  quantity: z.coerce.number().positive().optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
})

// POST /api/purchase-orders/[id]/receive
const receiveItemSchema = z.object({
  itemId: uuidSchema,
  receivedQuantity: z.coerce.number().min(0, 'Received quantity cannot be negative'),
  notes: z.string().max(500).optional(),
})
export const receivePurchaseOrderSchema = z.object({
  items: z.array(receiveItemSchema).min(1, 'At least one item is required'),
  notes: z.string().max(2000).optional(),
  warehouseId: z.string().uuid().optional(),
  updateStock: z.boolean().optional().default(false),
  supplierInvoiceNo: z.string().max(100).optional(),
  supplierBillDate: z.string().optional(),
})

// POST /api/purchase-orders/[id]/create-invoice
export const createPurchaseInvoiceSchema = z.object({
  supplierInvoiceNo: z.string().max(100).optional(),
  supplierBillDate: z.string().optional(),
  paymentTerm: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  costCenterId: optionalUuid,
  updateStock: z.boolean().optional().default(false),
  receivedQuantities: z.record(z.string(), z.string()).optional(),
})

// PUT /api/purchase-requisitions/[id]
export const updatePurchaseRequisitionSchema = z.object({
  department: z.string().max(100).optional(),
  costCenterId: optionalUuid,
  requiredByDate: z.string().optional(),
  purpose: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  status: purchaseRequisitionStatusSchema.optional(),
})

// PUT /api/supplier-quotations/[id]
export const updateSupplierQuotationSchema = z.object({
  validUntil: z.string().optional(),
  deliveryDays: z.coerce.number().int().min(0).optional(),
  paymentTerms: z.string().max(200).optional(),
  supplierReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  status: supplierQuotationStatusSchema.optional(),
  cancellationReason: z.string().max(1000).optional(),
})

// GET /api/supplier-quotations/compare
export const compareQuotationsSchema = z.object({
  ids: z.string().min(1, 'ids parameter is required'),
  requisitionId: z.string().uuid().optional(),
})

// DELETE /api/purchase-receipts/[id]
export const deletePurchaseReceiptSchema = z.object({
  cancellationReason: z.string().max(1000).optional(),
})
