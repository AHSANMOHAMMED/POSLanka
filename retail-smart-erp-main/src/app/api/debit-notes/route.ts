import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and } from 'drizzle-orm'
import { z } from 'zod'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { customers, debitNoteItems, debitNotes, sales } from '@/lib/db/schema'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { nextSequence } from '@/lib/inventory/item-codes'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { validateBody } from '@/lib/validation/helpers'
import { computeNoteLines } from '@/lib/accounting/note-lines'
import { postDebitNoteToGL } from '@/lib/accounting/notes-post'
import { tenantToday } from '@/lib/accounting/gl'

// Customer debit notes (H2): an additional charge against an issued invoice (under-billing,
// price increase, extra service). Issued notes post Dr receivable, Cr revenue + output VAT.

const itemSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  itemName: z.string().min(1).max(255),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  taxTemplateId: z.string().uuid().optional().nullable(),
  saleItemId: z.string().uuid().optional().nullable(),
  tax: z.coerce.number().min(0).optional(),
  total: z.coerce.number().min(0).optional(),
})

const createSchema = z.object({
  saleId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(255).optional(),
  reason: z.string().max(2000).optional(),
  items: z.array(itemSchema).min(1).max(200),
  status: z.enum(['draft', 'issued']).default('issued'),
})

export async function GET(request: NextRequest) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError
  const saleId = request.nextUrl.searchParams.get('saleId')

  const rows = await withAuthTenant(async (session, db) =>
    db.query.debitNotes.findMany({
      where: saleId && /^[0-9a-f-]{36}$/i.test(saleId)
        ? and(eq(debitNotes.tenantId, session.user.tenantId), eq(debitNotes.saleId, saleId))
        : eq(debitNotes.tenantId, session.user.tenantId),
      orderBy: [desc(debitNotes.createdAt)],
      limit: 100,
      with: { items: true },
    }))
  if (!rows) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ debitNotes: rows })
}

export async function POST(request: NextRequest) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError

  try {
    const result = await withAuthTenant(async (session, db) => {
      const parsed = await validateBody(request, createSchema)
      if (!parsed.success) {
        const details = await parsed.response.json().catch(() => ({ error: 'Invalid request body' }))
        return { error: details, status: 400 as const }
      }
      const body = parsed.data
      const tenantId = session.user.tenantId

      let sale: { id: string; customerId: string | null; customerName: string | null } | null = null
      if (body.saleId) {
        const row = await db.query.sales.findFirst({
          where: eq(sales.id, body.saleId),
          columns: { id: true, customerId: true, customerName: true, isReturn: true, status: true },
        })
        if (!row) return { error: 'Sale not found', status: 400 as const }
        if (row.isReturn || row.status === 'void') return { error: 'A debit note must reference a valid (non-void, non-return) invoice', status: 400 as const }
        if (body.customerId && row.customerId && body.customerId !== row.customerId) {
          return { error: 'Customer does not match the invoice', status: 400 as const }
        }
        sale = row
      }
      const customerId = body.customerId || sale?.customerId || null
      if (!customerId) return { error: 'A debit note needs a customer (it is charged to their account)', status: 400 as const }
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId), columns: { id: true, name: true, taxExempt: true } })
      if (!customer) return { error: 'Customer not found', status: 400 as const }

      let computed
      try {
        computed = await computeNoteLines(db, body.items, { saleId: sale?.id, taxExempt: !!customer.taxExempt })
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg === 'INVALID_TAX_TEMPLATE') return { error: 'Tax template not found or inactive', status: 400 as const }
        if (msg === 'INVALID_SALE_ITEM') return { error: 'Line does not belong to the referenced invoice', status: 400 as const }
        throw e
      }
      if (computed.total <= 0) return { error: 'Debit note total must be greater than zero', status: 400 as const }

      const seq = await nextSequence(db, tenantId, 'debit_note')
      const noteNo = `DN-${String(seq).padStart(6, '0')}`
      const postingDate = await tenantToday(tenantId)

      const [note] = await db.insert(debitNotes).values({
        tenantId,
        debitNoteNo: noteNo,
        saleId: sale?.id || null,
        customerId,
        customerName: body.customerName || customer.name,
        status: body.status,
        reason: body.reason || null,
        postingDate,
        subtotal: String(computed.subtotal),
        tax: String(computed.tax),
        total: String(computed.total),
        taxBreakdown: computed.taxBreakdown.length ? computed.taxBreakdown : null,
        createdBy: session.user.id,
      }).returning()

      await db.insert(debitNoteItems).values(computed.lines.map((line) => ({
        tenantId,
        debitNoteId: note.id,
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        taxTemplateId: line.taxTemplateId,
        taxRate: String(line.taxRate),
        tax: String(line.tax),
        taxBreakdown: line.taxBreakdown,
        total: String(line.total),
      })))

      if (body.status === 'issued') {
        const gl = await postDebitNoteToGL(db, tenantId, {
          noteId: note.id, noteNo, postingDate, total: computed.total, tax: computed.tax,
          taxBreakdown: computed.taxBreakdown, customerId, saleId: sale?.id || null,
        })
        if (gl) {
          await db.update(debitNotes).set({ glPosted: true }).where(eq(debitNotes.id, note.id))
          note.glPosted = true
        }
      }
      return { note }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.note, { status: 201 })
  } catch (err) {
    const apiError = toApiError(err)
    if (apiError) return apiError
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith('GL_ACCOUNTS_MISSING') || msg.startsWith('No active fiscal year')) {
      return NextResponse.json({ error: msg.replace(/^GL_ACCOUNTS_MISSING: /, ''), code: 'GL_ACCOUNTS_MISSING' }, { status: 400 })
    }
    logError('api/debit-notes', err)
    return NextResponse.json({ error: 'Failed to create debit note' }, { status: 500 })
  }
}
