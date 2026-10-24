import { z } from 'zod'
import { dateStringSchema, optionalUuid, paginatedSearchSchema } from './common'
import { chequeDetailsSchema } from './cheques'

// ==================== EXPENSES & REIMBURSEMENT CLAIMS (K1) ====================

export const expensePaymentMethodValues = ['cash', 'card', 'bank_transfer', 'cheque'] as const
export const expensePaidFromValues = ['drawer', 'cash', 'bank'] as const

const money = z.coerce.number().positive('Amount must be greater than zero').max(100_000_000)

// GET /api/expenses
export const expenseListSchema = paginatedSearchSchema.extend({
  kind: z.enum(['expense', 'reimbursement']).optional(),
  status: z.string().max(100).optional(), // one status or comma list
  categoryId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  paidFrom: z.enum(expensePaidFromValues).optional(),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  /** only my own (claims I made / expenses I recorded) */
  mine: z.string().optional().transform((v) => v === 'true' || v === '1'),
  openingEntryId: z.string().uuid().optional(),
})

/**
 * POST /api/expenses
 *  kind 'expense', paidFrom 'drawer': cashier pays from the open shift's drawer
 *    (a pos_cash_movement paid-out); above the counter's expense limit a supervisor approves.
 *  kind 'expense', paidFrom 'cash' | 'bank': recorded by accounts (office cash, bank, card, cheque).
 *  kind 'reimbursement': a staff member's claim for money spent out of pocket (pending).
 */
export const createExpenseSchema = z.object({
  kind: z.enum(['expense', 'reimbursement']).default('expense'),
  expenseDate: dateStringSchema.optional(),
  categoryId: optionalUuid,
  accountId: optionalUuid,
  amount: money,
  paidFrom: z.enum(expensePaidFromValues).optional(),
  paymentMethod: z.enum(expensePaymentMethodValues).optional(),
  payee: z.string().trim().max(255).optional().nullable(),
  receiptNo: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  attachmentUrl: z.string().trim().max(2000).optional().nullable(),
  warehouseId: optionalUuid,
  /** drawer expenses: the open shift (default: the caller's open shift) */
  openingEntryId: optionalUuid,
  /** reimbursement entered by accounts for another staff member */
  claimantId: optionalUuid,
  cheque: chequeDetailsSchema.optional(),
  /** supervisor approval (POST /api/auth/verify-pin, scope cash_paid_out) above the counter limit */
  approvalToken: z.string().max(2000).optional(),
}).superRefine((d, ctx) => {
  if (d.kind === 'expense') {
    if (!d.paidFrom) ctx.addIssue({ code: 'custom', path: ['paidFrom'], message: 'Choose where the money came from' })
    if (d.paidFrom === 'bank' && !d.paymentMethod) ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Choose how it was paid' })
    if (d.paymentMethod === 'cheque' && !d.cheque) ctx.addIssue({ code: 'custom', path: ['cheque'], message: 'Enter the cheque details' })
  }
  if (!d.categoryId && !d.accountId && !d.description) {
    ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category or describe the expense' })
  }
})

// PATCH /api/expenses/[id]
export const updateExpenseSchema = z.object({
  action: z.enum(['approve', 'reject', 'pay', 'void']),
  reason: z.string().trim().max(1000).optional(),
  /** pay: where the money comes from */
  paidFrom: z.enum(expensePaidFromValues).optional(),
  paymentMethod: z.enum(expensePaymentMethodValues).optional(),
  openingEntryId: optionalUuid,
  cheque: chequeDetailsSchema.optional(),
  accountId: optionalUuid,
}).superRefine((d, ctx) => {
  if ((d.action === 'reject' || d.action === 'void') && !d.reason) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' })
  }
  if (d.action === 'pay') {
    if (!d.paidFrom) ctx.addIssue({ code: 'custom', path: ['paidFrom'], message: 'Choose where the money comes from' })
    if (d.paidFrom === 'bank' && !d.paymentMethod) ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Choose how it is paid' })
    if (d.paymentMethod === 'cheque' && !d.cheque) ctx.addIssue({ code: 'custom', path: ['cheque'], message: 'Enter the cheque details' })
  }
})

// POST /api/expense-categories
export const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  accountId: optionalUuid,
  isActive: z.boolean().optional(),
})

// PATCH /api/expense-categories (bulk-free single update by id)
export const updateExpenseCategorySchema = createExpenseCategorySchema.partial().extend({
  id: z.string().uuid(),
})

// GET /api/dashboard/owner
export const ownerDashboardSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  topItems: z.coerce.number().int().min(1).max(50).default(10),
})
