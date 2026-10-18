import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentTerms } from '@/lib/db/schema'
import { eq, asc, ilike, and, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { paymentTermsListSchema, createPaymentTermSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, paymentTermsListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, all, active: activeOnly } = qp.data

    const conditions = []
    if (search) conditions.push(ilike(paymentTerms.name, `%${escapeLikePattern(search)}%`))
    if (activeOnly) conditions.push(eq(paymentTerms.isActive, true))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (all) {
      const data = await db.select().from(paymentTerms).where(where).orderBy(asc(paymentTerms.name)).limit(1000)
      return NextResponse.json(data)
    }

    const { page, pageSize } = qp.data

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(paymentTerms).where(where)
    const data = await db.select().from(paymentTerms).where(where).orderBy(asc(paymentTerms.name)).limit(pageSize).offset((page - 1) * pageSize)

    return NextResponse.json({
      data,
      pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
    })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function POST(request: NextRequest) {
  const result = await withAuthTenant(async (session, db) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createPaymentTermSchema)
    if (!parsed.success) return parsed.response
    const { name, invoicePortion, dueDateBasedOn, creditDays, discountType, discount, discountValidityDays, description } = parsed.data

    const [term] = await db.insert(paymentTerms).values({
      tenantId: session.user.tenantId,
      name,
      invoicePortion: String(invoicePortion),
      dueDateBasedOn,
      creditDays,
      discountType: discountType || null,
      discount: discount ? String(discount) : null,
      discountValidityDays: discountValidityDays || null,
      description: description || null,
    }).returning()

    logAndBroadcast(session.user.tenantId, 'payment-term', 'created', term.id)
    return NextResponse.json(term, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
