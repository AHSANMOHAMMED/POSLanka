import { z } from 'zod'
import { dateStringSchema, optionalUuid, paginatedSearchSchema, uuidSchema } from './common'

// drizzle/0185 — recurring invoice profiles (src/lib/recurring-invoices)

export const recurringLineSchema = z.object({
  itemId: uuidSchema,
  itemName: z.string().trim().min(1, 'Line name is required').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  unitPrice: z.coerce.number().min(0, 'Price cannot be negative').max(100_000_000),
  discount: z.coerce.number().min(0).max(100_000_000).default(0),
  uom: z.string().trim().max(20).nullish(),
  uomFactor: z.coerce.number().positive().max(1_000_000).default(1),
})

const profileFields = {
  profileName: z.string().trim().min(1, 'Profile name is required').max(150),
  customerId: uuidSchema,
  warehouseId: optionalUuid,
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  intervalCount: z.coerce.number().int().min(1).max(60).default(1),
  startDate: dateStringSchema,
  endType: z.enum(['never', 'after', 'on_date']).default('never'),
  endAfterCount: z.coerce.number().int().min(1).max(1000).nullish(),
  endDate: dateStringSchema.nullish(),
  invoiceAction: z.enum(['draft', 'final']).default('final'),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  notes: z.string().max(2000).nullish(),
  terms: z.string().max(5000).nullish(),
  notifyChannel: z.enum(['none', 'sms', 'whatsapp']).default('none'),
  lines: z.array(recurringLineSchema).min(1, 'Add at least one line').max(100),
}

type EndFields = { endType?: string; endAfterCount?: number | null; endDate?: string | null; startDate?: string }
function refineEnd(data: EndFields, ctx: z.RefinementCtx) {
  if (data.endType === 'after' && !data.endAfterCount) {
    ctx.addIssue({ code: 'custom', path: ['endAfterCount'], message: 'Enter after how many invoices the profile ends' })
  }
  if (data.endType === 'on_date') {
    if (!data.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Enter the end date' })
    else if (data.startDate && data.endDate < data.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is before the start date' })
  }
}

export const createRecurringInvoiceSchema = z.object(profileFields).superRefine(refineEnd)

export const updateRecurringInvoiceSchema = z.object(profileFields).superRefine(refineEnd)

export const recurringInvoiceActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop']),
})

export const recurringInvoicesListSchema = paginatedSearchSchema.extend({
  status: z.enum(['active', 'paused', 'stopped', 'completed', 'all']).optional(),
  customerId: z.string().uuid().optional(),
})

export const recurringPreviewSchema = z.object({
  customerId: optionalUuid,
  lines: z.array(recurringLineSchema).min(1).max(100),
})
