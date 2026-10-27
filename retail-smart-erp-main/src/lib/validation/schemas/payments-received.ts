import { z } from 'zod'
import { dateStringSchema, paginationSchema, uuidSchema } from './common'
import { chequeDetailsSchema } from './cheques'

// drizzle/0185 — payments received (customer receipts over one or many invoices)

export const paymentsReceivedListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  method: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'credit', 'gift_card']).optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  kind: z.enum(['invoice_payment', 'credit_deposit']).optional(),
})

export const unpaidInvoicesSchema = z.object({
  customerId: uuidSchema,
})

const money = z.coerce.number().min(0).max(1_000_000_000)

export const recordPaymentSchema = z.object({
  customerId: uuidSchema,
  /** money received (cash / card / transfer / cheque) */
  amountReceived: money.default(0),
  method: z.enum(['cash', 'card', 'bank_transfer', 'cheque']).default('cash'),
  reference: z.string().trim().max(255).optional(),
  notes: z.string().max(2000).optional(),
  /** per invoice: money allocated (amount) and the customer's store credit applied (creditAmount) */
  allocations: z.array(z.object({
    saleId: uuidSchema,
    amount: money.default(0),
    creditAmount: money.default(0),
  })).max(100).default([]),
  /** keep money received beyond the allocations as customer credit (advance) */
  excessToCredit: z.boolean().default(false),
  cheque: chequeDetailsSchema.optional(),
}).superRefine((d, ctx) => {
  const ids = new Set<string>()
  for (const [i, a] of d.allocations.entries()) {
    if (ids.has(a.saleId)) ctx.addIssue({ code: 'custom', path: ['allocations', i, 'saleId'], message: 'Invoice listed twice' })
    ids.add(a.saleId)
  }
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0)
  if (allocated - d.amountReceived > 0.004) {
    ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'Allocated more than the amount received' })
  }
  const credit = d.allocations.reduce((s, a) => s + a.creditAmount, 0)
  if (d.amountReceived <= 0 && credit <= 0) ctx.addIssue({ code: 'custom', path: ['amountReceived'], message: 'Enter the amount received' })
  if (d.method === 'cheque' && d.amountReceived > 0) {
    if (!d.cheque) ctx.addIssue({ code: 'custom', path: ['cheque'], message: 'Enter the cheque number, bank and date' })
    if (d.allocations.filter((a) => a.amount > 0).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'A cheque settles one invoice here; record other invoices separately' })
    }
  }
})
