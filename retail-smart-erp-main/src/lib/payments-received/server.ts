/**
 * Payments received (drizzle/0185): customer receipts over one or many unpaid invoices.
 *
 * "Record payment" never books money itself: each allocation runs POST /api/sales/[id]/payments
 * (payment row, cheque register, store credit use, customer credit ledger, sale status, GL), the
 * money left over is kept as customer credit through the same route's overpayment-to-credit
 * option (or POST /api/customers/[id]/credit when nothing is allocated). This module only groups
 * those into a numbered receipt (payment_receipts / payment_receipt_allocations) for printing and
 * the Payments Received list.
 *
 * Allocations run one after another (each its own locked transaction, as on the invoice page);
 * if one is refused the receipt keeps what went through, is marked 'partial' and says why.
 *
 * Server-only.
 */
import { NextRequest } from 'next/server'
import { and, desc, eq, gte, isNull, notInArray, sql } from 'drizzle-orm'
import { withTenant, type TenantDb } from '@/lib/db'
import { customers, payments, paymentReceiptAllocations, paymentReceipts, sales } from '@/lib/db/schema'
import { nextDocNo } from '@/lib/documents/numbering'
import { roundCurrency } from '@/lib/utils/currency'
import type { BranchScope } from '@/lib/auth/branch-access'
import { colomboDate } from '@/lib/messaging/service'
import type { z } from 'zod'
import type { recordPaymentSchema } from '@/lib/validation/schemas/payments-received'

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

function rows<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]
}

/** ` AND (<col> IS NULL OR <col> IN scope)` for branch-restricted staff; `col` is trusted SQL text */
export function scopeSql(scope: BranchScope, col: string) {
  if (!scope) return sql``
  if (scope.length === 0) return sql` AND ${sql.raw(col)} IS NULL`
  return sql` AND (${sql.raw(col)} IS NULL OR ${sql.raw(col)} IN (${sql.join(scope.map((id) => sql`${id}::uuid`), sql`, `)}))`
}

export interface UnpaidInvoice {
  id: string
  invoiceNo: string
  createdAt: string
  total: number
  paid: number
  balance: number
  warehouseId: string | null
  dueDate: string | null
}

/**
 * Open invoices of a customer, oldest first. Balance = total − active payments − submitted payment
 * entry allocations (the same figure POST /api/sales/[id]/payments checks against).
 */
export async function unpaidInvoices(db: TenantDb, customerId: string, scope: BranchScope): Promise<UnpaidInvoice[]> {
  const branch = scopeSql(scope, 's.warehouse_id')
  const res = await db.execute(sql`
    SELECT s.id, s.invoice_no AS "invoiceNo", s.created_at AS "createdAt", s.total::float AS total, s.warehouse_id AS "warehouseId",
           (COALESCE(p.paid, 0) + COALESCE(pe.paid, 0))::float AS paid,
           (SELECT r.due_date::text FROM recurring_invoice_runs r WHERE r.sale_id = s.id LIMIT 1) AS "dueDate"
    FROM sales s
    LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE sale_id = s.id AND voided_at IS NULL) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(per.allocated_amount) AS paid FROM payment_entry_references per
      LEFT JOIN payment_entries pe2 ON pe2.id = per.payment_entry_id
      WHERE per.reference_type = 'sale' AND per.reference_id = s.id
        AND (pe2.status = 'submitted' OR per.source_je_item_id IS NOT NULL)
    ) pe ON TRUE
    WHERE s.customer_id = ${customerId}::uuid AND s.status <> 'void' AND s.is_return = false
      AND s.total - COALESCE(p.paid, 0) - COALESCE(pe.paid, 0) > 0.004${branch}
    ORDER BY s.created_at ASC
    LIMIT 500`)
  return rows<Omit<UnpaidInvoice, 'balance'>>(res).map((r) => ({
    ...r, createdAt: String(r.createdAt), balance: roundCurrency(Number(r.total) - Number(r.paid)),
  }))
}

export interface RecordPaymentResult {
  status: number
  body: Record<string, unknown>
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

function jsonReq(url: string, body: unknown) {
  return new NextRequest(new URL(url, process.env.NEXTAUTH_URL || 'http://localhost'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

/**
 * Record a customer payment (see header). Runs in the caller's request context (its session is
 * what the reused routes authenticate). Returns the receipt id and what was applied.
 */
export async function recordCustomerPayment(
  session: { user: { id: string; tenantId: string; name?: string | null } }, userId: string, input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const tenantId = session.user.tenantId
  const allocations = input.allocations.filter((a) => a.amount > 0.004 || a.creditAmount > 0.004)
  const allocated = roundCurrency(allocations.reduce((s, a) => s + a.amount, 0))
  const excess = roundCurrency(input.amountReceived - allocated)
  if (excess > 0.004 && !input.excessToCredit) {
    return { status: 400, body: { error: 'Allocate the full amount received, or keep the excess as customer credit', code: 'UNALLOCATED_AMOUNT', excess } }
  }

  // Validate the invoices and create the receipt (numbered) before any money is booked
  const prep = await withTenant(tenantId, async (db) => {
    const [customer] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, input.customerId))
    if (!customer) return { error: { status: 400, body: { error: 'Customer not found' } } }
    const ids = allocations.map((a) => a.saleId)
    const found = ids.length
      ? await db.select({ id: sales.id, customerId: sales.customerId, invoiceNo: sales.invoiceNo, warehouseId: sales.warehouseId, status: sales.status, isReturn: sales.isReturn })
        .from(sales).where(sql`${sales.id} IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)
      : []
    const byId = new Map(found.map((s) => [s.id, s]))
    for (const a of allocations) {
      const s = byId.get(a.saleId)
      if (!s) return { error: { status: 404, body: { error: 'Invoice not found', saleId: a.saleId } } }
      if (s.customerId !== input.customerId) return { error: { status: 400, body: { error: `Invoice ${s.invoiceNo} belongs to another customer`, code: 'CUSTOMER_MISMATCH' } } }
      if (s.status === 'void' || s.isReturn) return { error: { status: 400, body: { error: `Invoice ${s.invoiceNo} cannot take payments` } } }
    }
    const receiptNo = await nextDocNo(db, tenantId, 'payment_receipt')
    const [receipt] = await db.insert(paymentReceipts).values({
      tenantId, receiptNo, customerId: input.customerId,
      warehouseId: found[0]?.warehouseId ?? null,
      receiptDate: colomboDate(), method: input.method, reference: input.reference || null,
      amountReceived: String(roundCurrency(input.amountReceived)), status: 'partial', notes: input.notes || null, createdBy: userId,
    }).returning({ id: paymentReceipts.id, receiptNo: paymentReceipts.receiptNo })
    return { receipt, byId, customer }
  })
  if ('error' in prep && prep.error) return prep.error as RecordPaymentResult
  const { receipt, byId } = prep as Exclude<typeof prep, { error: unknown }>

  const { POST: addSalePayment } = await import('@/app/api/sales/[id]/payments/route') as { POST: Handler }
  const applied: Array<{ saleId: string; invoiceNo: string; amount: number; creditAmount: number; balanceDue?: number; status?: string }> = []
  const linked: string[] = []
  let failure: { saleId?: string; invoiceNo?: string; error: string; code?: string; status: number } | null = null
  let allocatedDone = 0
  let creditDone = 0
  let excessDone = 0
  const startedAt = new Date(Date.now() - 1000)

  for (const [i, a] of allocations.entries()) {
    const sale = byId.get(a.saleId)!
    const last = i === allocations.length - 1
    // The money beyond the allocations rides on the last invoice as overpayment-to-credit
    const extra = last && excess > 0.004 && input.excessToCredit && a.amount + excess > 0 ? excess : 0
    const amount = roundCurrency(a.amount + extra)
    const res = await addSalePayment(jsonReq(`/api/sales/${a.saleId}/payments`, {
      amount, method: input.method, reference: input.reference || receipt.receiptNo, creditAmount: roundCurrency(a.creditAmount),
      addOverpaymentToCredit: extra > 0,
      ...(input.method === 'cheque' && amount > 0 && input.cheque ? { cheque: input.cheque } : {}),
    }), { params: Promise.resolve({ id: a.saleId }) })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      failure = { saleId: a.saleId, invoiceNo: sale.invoiceNo, error: String(data.error || 'Payment refused'), code: data.code ? String(data.code) : undefined, status: res.status }
      break
    }
    // the payment row the route just wrote (latest unlinked one of this user on this invoice)
    const findPayment = (value: number, credit: boolean) => withTenant(tenantId, async (db) => {
      const [p] = await db.select({ id: payments.id }).from(payments)
        .where(and(eq(payments.saleId, a.saleId), eq(payments.receivedBy, userId), eq(payments.amount, String(value)),
          credit ? sql`${payments.method} = 'credit'` : sql`${payments.method} <> 'credit'`, gte(payments.createdAt, startedAt), isNull(payments.voidedAt),
          linked.length ? notInArray(payments.id, linked) : undefined))
        .orderBy(desc(payments.createdAt)).limit(1)
      if (p) linked.push(p.id)
      return p?.id ?? null
    })
    const paymentId = amount > 0 ? await findPayment(amount, false) : null
    const creditPaymentId = a.creditAmount > 0 ? await findPayment(roundCurrency(a.creditAmount), true) : null
    await withTenant(tenantId, (db) => db.insert(paymentReceiptAllocations).values({
      tenantId, receiptId: receipt.id, saleId: a.saleId, invoiceNo: sale.invoiceNo,
      amount: String(roundCurrency(a.amount)), creditAmount: String(roundCurrency(a.creditAmount)), paymentId, creditPaymentId,
    }))
    allocatedDone = roundCurrency(allocatedDone + a.amount)
    creditDone = roundCurrency(creditDone + a.creditAmount)
    excessDone = roundCurrency(excessDone + extra)
    applied.push({ saleId: a.saleId, invoiceNo: sale.invoiceNo, amount: a.amount, creditAmount: a.creditAmount, balanceDue: Number(data.balanceDue), status: String(data.status || '') })
  }

  // Nothing allocated at all: the whole amount is an advance (customer credit deposit)
  if (!failure && allocations.length === 0 && excess > 0.004) {
    const { POST: addCredit } = await import('@/app/api/customers/[id]/credit/route') as { POST: Handler }
    const res = await addCredit(jsonReq(`/api/customers/${input.customerId}/credit`, {
      amount: excess, type: 'add', referenceType: 'payment_receipt', referenceId: receipt.id,
      notes: `Advance received ${receipt.receiptNo}${input.reference ? ` (${input.reference})` : ''}`,
    }), { params: Promise.resolve({ id: input.customerId }) })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) failure = { error: String(data.error || 'Could not add the customer credit'), status: res.status }
    else excessDone = excess
  }

  const complete = !failure
  await withTenant(tenantId, (db) => db.update(paymentReceipts).set({
    amountReceived: String(complete ? roundCurrency(input.amountReceived) : roundCurrency(allocatedDone + excessDone)),
    amountAllocated: String(allocatedDone), creditApplied: String(creditDone), excessToCredit: String(excessDone),
    status: complete ? 'completed' : 'partial', error: failure ? `${failure.invoiceNo ? `${failure.invoiceNo}: ` : ''}${failure.error}` : null,
  }).where(eq(paymentReceipts.id, receipt.id)))

  // A receipt nothing went through on is not kept
  if (!complete && applied.length === 0 && excessDone === 0) {
    await withTenant(tenantId, (db) => db.delete(paymentReceipts).where(eq(paymentReceipts.id, receipt.id)))
    return { status: failure!.status >= 400 ? failure!.status : 400, body: { error: failure!.error, code: failure!.code, invoiceNo: failure!.invoiceNo } }
  }
  return {
    status: complete ? 201 : 207,
    body: {
      id: receipt.id, receiptNo: receipt.receiptNo, status: complete ? 'completed' : 'partial',
      allocated: allocatedDone, creditApplied: creditDone, excessToCredit: excessDone, applied,
      ...(failure ? { error: `Stopped at ${failure.invoiceNo || 'customer credit'}: ${failure.error}`, failed: failure } : {}),
    },
  }
}
