import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and, ne, sql } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { creditNotes, creditNoteItems, customers, sales } from '@/lib/db/schema'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { nextSequence } from '@/lib/inventory/item-codes'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'
import { computeNoteLines } from '@/lib/accounting/note-lines'
import { postCreditNoteToGL } from '@/lib/accounting/notes-post'
import { tenantToday } from '@/lib/accounting/gl'
import { roundCurrency } from '@/lib/utils/currency'

// Credit notes are financial adjustments to an issued invoice (price correction, allowance,
// goodwill) with no goods movement — returned goods go through a sales return (POST /api/sales
// with isReturn), which restocks and refunds. An issued credit note reverses revenue and output
// VAT and either reduces the customer's receivable or records a refund (src/lib/accounting/notes-post.ts).

const itemSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  itemName: z.string().min(1).max(255),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxTemplateId: z.string().uuid().optional().nullable(),
  saleItemId: z.string().uuid().optional().nullable(),
  // Legacy flat-tax clients: line tax and line value excl. tax
  tax: z.coerce.number().min(0).optional(),
  total: z.coerce.number().min(0).optional(),
})

const createSchema = z.object({
  saleId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(255).optional(),
  reason: z.string().max(2000).optional(),
  // Optional client totals: validated against the lines (legacy clients send them)
  subtotal: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  total: z.coerce.number().min(0).optional(),
  items: z.array(itemSchema).min(1).max(200),
  status: z.enum(['draft', 'issued']).default('issued'),
  settlement: z.enum(['receivable', 'refund']).optional(),
  refundMethod: z.string().max(30).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError
  const saleId = request.nextUrl.searchParams.get('saleId')

  const result = await withAuthTenant(async (session, db) => {
    const rows = await db.query.creditNotes.findMany({
      where: saleId && /^[0-9a-f-]{36}$/i.test(saleId)
        ? and(eq(creditNotes.tenantId, session.user.tenantId), eq(creditNotes.saleId, saleId))
        : eq(creditNotes.tenantId, session.user.tenantId),
      orderBy: [desc(creditNotes.createdAt)],
      limit: 100,
      with: { items: true },
    })
    return { rows }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ creditNotes: result.rows })
}

export async function POST(request: NextRequest) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError

  let result
  try {
    result = await withAuthTenant(async (session, db) => {
      const parsed = await validateBody(request, createSchema)
      if (!parsed.success) {
        const details = await parsed.response.json().catch(() => ({ error: 'Invalid request body' }))
        return { error: details, status: 400 as const }
      }
      const body = parsed.data
      const tenantId = session.user.tenantId

      const tx = db
      {
        // The referenced sale must belong to this tenant (RLS-scoped lookup); lock it so two
        // concurrent notes cannot both credit the same remaining amount.
        let sale: { id: string; total: string; customerId: string | null; customerName: string | null; isReturn: boolean; status: string } | null = null
        if (body.saleId) {
          const [row] = await tx.select({
            id: sales.id, total: sales.total, customerId: sales.customerId, customerName: sales.customerName,
            isReturn: sales.isReturn, status: sales.status,
          }).from(sales).where(eq(sales.id, body.saleId)).for('update')
          if (!row) return { error: 'Sale not found', status: 400 as const }
          if (row.isReturn || row.status === 'void') return { error: 'A credit note must reference a valid (non-void, non-return) invoice', status: 400 as const }
          if (body.customerId && row.customerId && body.customerId !== row.customerId) {
            return { error: 'Customer does not match the invoice', status: 400 as const }
          }
          sale = row
        }
        const customerId = body.customerId || sale?.customerId || null
        let customer: { id: string; name: string; taxExempt: boolean | null } | null = null
        if (customerId) {
          const c = await tx.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { id: true, name: true, taxExempt: true } })
          if (!c) return { error: 'Customer not found', status: 400 as const }
          customer = c
        }

        let computed
        try {
          computed = await computeNoteLines(tx, body.items, { saleId: sale?.id, taxExempt: !!customer?.taxExempt })
        } catch (e) {
          const msg = e instanceof Error ? e.message : ''
          if (msg === 'INVALID_TAX_TEMPLATE') return { error: 'Tax template not found or inactive', status: 400 as const }
          if (msg === 'INVALID_SALE_ITEM') return { error: 'Line does not belong to the referenced invoice', status: 400 as const }
          throw e
        }

        // Legacy clients send totals: they must add up (total = subtotal + tax, subtotal = sum of lines)
        if (computed.clientTax && body.total !== undefined) {
          const subtotal = body.subtotal ?? computed.subtotal
          const tax = body.tax ?? computed.tax
          if (Math.abs(subtotal + tax - body.total) > 0.01 || Math.abs(computed.subtotal - subtotal) > 0.05 || Math.abs(computed.tax - tax) > 0.05) {
            return { error: 'Credit note totals do not add up (total must equal subtotal + tax, subtotal the sum of the lines)', status: 400 as const }
          }
        }
        if (computed.total <= 0) return { error: 'Credit note total must be greater than zero', status: 400 as const }

        // Cannot credit more than what is left of the invoice (earlier credit notes and returns)
        if (sale) {
          const [{ credited }] = await tx.select({ credited: sql<string>`COALESCE(SUM(${creditNotes.total}), 0)` })
            .from(creditNotes)
            .where(and(eq(creditNotes.saleId, sale.id), ne(creditNotes.status, 'cancelled')))
          const [{ returned }] = await tx.select({ returned: sql<string>`COALESCE(SUM(ABS(${sales.total})), 0)` })
            .from(sales)
            .where(and(eq(sales.returnAgainst, sale.id), eq(sales.isReturn, true), ne(sales.status, 'void')))
          const remaining = roundCurrency(Number(sale.total) - Number(credited) - Number(returned))
          if (computed.total > remaining + 0.01) {
            return { error: `Credit note exceeds the invoice balance still creditable (${remaining.toFixed(2)})`, status: 400 as const }
          }
        }

        const settlement = body.settlement || (customerId ? 'receivable' : 'refund')
        if (settlement === 'receivable' && !customerId) {
          return { error: 'A credit note against the receivable needs a customer (or use settlement "refund")', status: 400 as const }
        }

        // Race-free numbering: per-tenant sequence allocated inside this transaction.
        const seq = await nextSequence(tx, tenantId, 'credit_note')
        const nextNo = `CN-${String(seq).padStart(6, '0')}`
        const postingDate = await tenantToday(tenantId)

        const [note] = await tx
          .insert(creditNotes)
          .values({
            tenantId,
            creditNoteNo: nextNo,
            saleId: sale?.id || null,
            customerId,
            customerName: body.customerName || customer?.name || sale?.customerName || null,
            reason: body.reason || null,
            subtotal: String(computed.subtotal),
            tax: String(computed.tax),
            total: String(computed.total),
            taxBreakdown: computed.taxBreakdown.length ? computed.taxBreakdown : null,
            settlement,
            refundMethod: settlement === 'refund' ? body.refundMethod || 'cash' : null,
            postingDate,
            status: body.status,
            createdBy: session.user.id,
          })
          .returning()

        await tx.insert(creditNoteItems).values(
          computed.lines.map((line) => ({
            tenantId,
            creditNoteId: note.id,
            itemId: line.itemId,
            itemName: line.itemName,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            taxTemplateId: line.taxTemplateId,
            taxRate: String(line.taxRate),
            tax: String(line.tax),
            taxBreakdown: line.taxBreakdown,
            total: String(line.total),
          }))
        )

        if (body.status === 'issued') {
          const gl = await postCreditNoteToGL(tx, tenantId, {
            noteId: note.id, noteNo: nextNo, postingDate, total: computed.total, tax: computed.tax,
            taxBreakdown: computed.taxBreakdown, customerId, saleId: sale?.id || null,
            settlement, refundMethod: note.refundMethod,
          })
          if (gl) {
            await tx.update(creditNotes).set({ glPosted: true }).where(eq(creditNotes.id, note.id))
            note.glPosted = true
          }
        }
        return { note }
      }
    })
  } catch (err) {
    const apiError = toApiError(err)
    if (apiError) return apiError
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith('GL_ACCOUNTS_MISSING') || msg.startsWith('No active fiscal year')) {
      return NextResponse.json({ error: msg.replace(/^GL_ACCOUNTS_MISSING: /, ''), code: 'GL_ACCOUNTS_MISSING' }, { status: 400 })
    }
    logError('api/credit-notes', err)
    return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 })
  }

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.note, { status: 201 })
}
