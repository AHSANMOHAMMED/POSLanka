import { z } from 'zod'
import { dateStringSchema, optionalUuid, paginatedSearchSchema, uuidSchema } from './common'

// ==================== CHEQUES (K1) ====================

export const chequeDirectionValues = ['received', 'issued'] as const
export const chequeStatusValues = ['pending', 'deposited', 'cleared', 'bounced', 'cancelled', 'returned'] as const

/**
 * Cheque details carried by a payment (POS sale, receipt against credit, supplier payment).
 * amount defaults to the cheque tender; when given it must equal it.
 */
export const chequeDetailsSchema = z.object({
  chequeNo: z.string().trim().min(1, 'Cheque number is required').max(50),
  bankName: z.string().trim().min(1, 'Bank is required').max(100),
  branchName: z.string().trim().max(100).optional().nullable(),
  chequeDate: dateStringSchema,
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
  /** drawer (received) / payee (issued) when different from the customer / supplier name */
  partyName: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})
export type ChequeDetailsInput = z.infer<typeof chequeDetailsSchema>

// GET /api/cheques
export const chequeListSchema = paginatedSearchSchema.extend({
  status: z.string().max(100).optional(), // one status or a comma list; 'open' = pending + deposited
  direction: z.enum(chequeDirectionValues).optional(),
  /** cheque date within the next N days (and overdue open cheques) */
  dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  warehouseId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
})

// POST /api/cheques — a cheque recorded on its own (register entry; settles nothing)
export const createChequeSchema = chequeDetailsSchema.extend({
  direction: z.enum(chequeDirectionValues),
  amount: z.coerce.number().positive('Amount must be greater than zero').max(1_000_000_000),
  customerId: optionalUuid,
  supplierId: optionalUuid,
  warehouseId: optionalUuid,
}).superRefine((d, ctx) => {
  if (d.direction === 'received' && d.supplierId) ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'A received cheque comes from a customer' })
  if (d.direction === 'issued' && d.customerId) ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'An issued cheque goes to a supplier or payee' })
  if (!d.customerId && !d.supplierId && !d.partyName) ctx.addIssue({ code: 'custom', path: ['partyName'], message: 'Enter who the cheque is from / to' })
})

// PATCH /api/cheques/[id] — status change
export const updateChequeStatusSchema = z.object({
  action: z.enum(['deposit', 'clear', 'bounce', 'cancel', 'return']),
  /** deposit / clear: bank account (chart of accounts) the cheque went into */
  depositAccountId: optionalUuid,
  reason: z.string().trim().max(1000).optional(),
  /** date of the event (default today) */
  date: dateStringSchema.optional(),
}).superRefine((d, ctx) => {
  if ((d.action === 'bounce' || d.action === 'cancel') && !d.reason) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' })
  }
})

export const chequeIdParamSchema = z.object({ id: uuidSchema })
