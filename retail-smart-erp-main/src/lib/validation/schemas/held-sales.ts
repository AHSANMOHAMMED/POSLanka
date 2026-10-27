import { z } from 'zod'
import { uuidSchema, optionalUuid } from './common'

// ==================== HELD SALES ====================

// GET /api/held-sales
export const heldSalesListSchema = z.object({
  includeExpired: z.string().optional().transform(v => v === 'true'),
})

// POST /api/held-sales
export const createHeldSaleSchema = z.object({
  customerId: optionalUuid,
  vehicleId: optionalUuid,
  cartItems: z.array(z.object({
    itemId: uuidSchema,
    name: z.string().max(255),
    quantity: z.coerce.number().positive('Quantity must be greater than zero'),
    unitPrice: z.coerce.number(),
    total: z.coerce.number(),
    // H5: unit of the held line (reservations count quantity × uomFactor base units)
    uom: z.string().trim().max(20).optional(),
    uomFactor: z.coerce.number().positive().optional(),
    // Print studio: width × height of an area/length-priced line, so a recalled line reopens its size dialog
    sizeSpec: z.object({
      pricingMode: z.enum(['area', 'length']),
      areaUnit: z.enum(['sqft', 'sqm']),
      width: z.coerce.number().positive(),
      height: z.coerce.number().positive().nullable(),
      sizeUnit: z.enum(['inch', 'ft', 'cm', 'mm', 'm']),
      pieces: z.coerce.number().positive(),
      sides: z.coerce.number().int().min(1).max(2),
      minChargeArea: z.coerce.number().nonnegative().nullable(),
      baseName: z.string().max(255),
    }).optional(),
  })).min(1, 'Cart items are required').max(500),
  subtotal: z.coerce.number().default(0),
  notes: z.string().max(5000).nullish(),
  customerName: z.string().max(255).nullish(),
  vehiclePlate: z.string().max(100).nullish(),
  vehicleDescription: z.string().max(500).nullish(),
  warehouseId: optionalUuid,
  expirationHours: z.coerce.number().min(0.01).max(168, 'Maximum 168 hours (7 days)').optional(),
})
