import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { creditNotes, creditNoteItems, sales } from '@/lib/db/schema'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { nextSequence } from '@/lib/inventory/item-codes'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { requireTenantFeature } from '@/lib/features/check'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'

const itemSchema = z.object({
  itemId: z.string().uuid().optional().nullable(),
  itemName: z.string().min(1).max(255),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
})

const createSchema = z.object({
  saleId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(255).optional(),
  reason: z.string().optional(),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  items: z.array(itemSchema).min(1).max(200),
  status: z.enum(['draft', 'issued']).default('issued'),
})

export async function GET() {
  const result = await withAuthTenant(async (session, db) => {
    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Credit notes disabled', status: 403 as const, rows: [] as never[] }
    }
    const rows = await db.query.creditNotes.findMany({
      where: eq(creditNotes.tenantId, session.user.tenantId),
      orderBy: [desc(creditNotes.createdAt)],
      limit: 100,
      with: { items: true },
    })
    return { rows }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result && result.status === 403) {
    return NextResponse.json({ error: result.error }, { status: 403 })
  }
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
      const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
      if (!feature.ok) {
        return { error: 'Credit notes disabled', status: 403 as const }
      }
      const parsed = await validateBody(request, createSchema)
      if (!parsed.success) {
        const details = await parsed.response.json().catch(() => ({ error: 'Invalid request body' }))
        return { error: details, status: 400 as const }
      }

      // The referenced sale must belong to this tenant (RLS-scoped lookup).
      if (parsed.data.saleId) {
        const sale = await db.query.sales.findFirst({
          where: eq(sales.id, parsed.data.saleId),
          columns: { id: true },
        })
        if (!sale) {
          return { error: 'Sale not found', status: 400 as const }
        }
      }

      // Race-free numbering: per-tenant sequence allocated inside this transaction.
      const seq = await nextSequence(db, session.user.tenantId, 'credit_note')
      const nextNo = `CN-${String(seq).padStart(6, '0')}`

      const [note] = await db
        .insert(creditNotes)
        .values({
          tenantId: session.user.tenantId,
          creditNoteNo: nextNo,
          saleId: parsed.data.saleId || null,
          customerId: parsed.data.customerId || null,
          customerName: parsed.data.customerName || null,
          reason: parsed.data.reason || null,
          subtotal: String(parsed.data.subtotal),
          tax: String(parsed.data.tax),
          total: String(parsed.data.total),
          status: parsed.data.status,
          createdBy: session.user.id,
        })
        .returning()

      await db.insert(creditNoteItems).values(
        parsed.data.items.map((item) => ({
          tenantId: session.user.tenantId,
          creditNoteId: note.id,
          itemId: item.itemId || null,
          itemName: item.itemName,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          tax: String(item.tax),
          total: String(item.total),
        }))
      )

      return { note }
    })
  } catch (err) {
    const apiError = toApiError(err)
    if (apiError) return apiError
    logError('api/credit-notes', err)
    return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 })
  }

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.note, { status: 201 })
}
