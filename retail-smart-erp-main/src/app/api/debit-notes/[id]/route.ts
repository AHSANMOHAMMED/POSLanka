import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { debitNotes, einvoiceOutbox } from '@/lib/db/schema'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { postDebitNoteToGL, reverseNoteGL } from '@/lib/accounting/notes-post'
import { tenantToday } from '@/lib/accounting/gl'
import type { TaxBreakdownItem } from '@/lib/utils/tax-template'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response

  const note = await withAuthTenant(async (_session, db) =>
    db.query.debitNotes.findFirst({
      where: eq(debitNotes.id, p.data.id),
      with: { items: true, customer: true, sale: { columns: { id: true, invoiceNo: true, createdAt: true } } },
    }))
  if (!note) return NextResponse.json({ error: 'Debit note not found' }, { status: 404 })
  return NextResponse.json(note)
}

const actionSchema = z.object({ action: z.enum(['issue', 'cancel']) })

// PATCH /api/debit-notes/[id] {action: 'issue' | 'cancel'}
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const authSession = await authWithCompany()
  if (!authSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(authSession, 'manageSales')
  if (permError) return permError
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, actionSchema)
  if (!parsed.success) return parsed.response

  try {
    const result = await withAuthTenant(async (session, db) => {
      const tenantId = session.user.tenantId
      const [note] = await db.select().from(debitNotes).where(eq(debitNotes.id, p.data.id)).for('update')
      if (!note) return { error: 'Debit note not found', status: 404 as const }
      const today = await tenantToday(tenantId)

      if (parsed.data.action === 'issue') {
        if (note.status !== 'draft') return { error: `Debit note is ${note.status}`, status: 400 as const }
        const gl = await postDebitNoteToGL(db, tenantId, {
          noteId: note.id, noteNo: note.debitNoteNo, postingDate: today, total: Number(note.total), tax: Number(note.tax),
          taxBreakdown: (note.taxBreakdown as TaxBreakdownItem[] | null) || null, customerId: note.customerId, saleId: note.saleId,
        })
        const [updated] = await db.update(debitNotes)
          .set({ status: 'issued', postingDate: today, glPosted: !!gl, updatedAt: new Date() })
          .where(eq(debitNotes.id, note.id)).returning()
        return { note: updated }
      }

      if (note.status === 'cancelled') return { error: 'Debit note is already cancelled', status: 400 as const }
      const outboxWhere = and(eq(einvoiceOutbox.sourceType, 'debit_note'), eq(einvoiceOutbox.documentId, note.id))
      const sent = await db.query.einvoiceOutbox.findFirst({ where: outboxWhere, columns: { status: true } })
      if (sent && (sent.status === 'sent' || sent.status === 'acknowledged')) {
        return { error: 'Debit note was already transmitted to the tax authority; issue a credit note instead', status: 409 as const }
      }
      if (note.glPosted) await reverseNoteGL(db, tenantId, 'debit_note', note.id, today)
      if (sent) await db.delete(einvoiceOutbox).where(outboxWhere)
      const [updated] = await db.update(debitNotes)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(debitNotes.id, note.id)).returning()
      return { note: updated }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.note)
  } catch (err) {
    const apiError = toApiError(err)
    if (apiError) return apiError
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith('GL_ACCOUNTS_MISSING') || msg.startsWith('No active fiscal year')) {
      return NextResponse.json({ error: msg.replace(/^GL_ACCOUNTS_MISSING: /, ''), code: 'GL_ACCOUNTS_MISSING' }, { status: 400 })
    }
    logError('api/debit-notes/[id]', err)
    return NextResponse.json({ error: 'Failed to update debit note' }, { status: 500 })
  }
}
