import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentTermsTemplates, paymentTermsTemplateItems, paymentTerms } from '@/lib/db/schema'
import { eq, asc, ilike, and, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { paymentTermsTemplatesListSchema, createPaymentTermsTemplateSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, paymentTermsTemplatesListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, all, active: activeOnly } = qp.data

    const conditions = []
    if (search) conditions.push(ilike(paymentTermsTemplates.name, `%${escapeLikePattern(search)}%`))
    if (activeOnly) conditions.push(eq(paymentTermsTemplates.isActive, true))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (all) {
      const data = await db.select().from(paymentTermsTemplates).where(where).orderBy(asc(paymentTermsTemplates.name)).limit(1000)
      return NextResponse.json(data)
    }

    const { page, pageSize } = qp.data

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(paymentTermsTemplates).where(where)
    const data = await db.select().from(paymentTermsTemplates).where(where).orderBy(asc(paymentTermsTemplates.name)).limit(pageSize).offset((page - 1) * pageSize)

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

    const parsed = await validateBody(request, createPaymentTermsTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, items } = parsed.data

    // Validate items if provided
    if (items && items.length > 0) {
      // Fetch the terms to validate portions
      const termIds = items.map((i: { paymentTermId: string }) => i.paymentTermId)
      const terms = await db.select().from(paymentTerms).where(
        sql`${paymentTerms.id} IN ${termIds}`
      )
      const termMap = new Map(terms.map(t => [t.id, t]))
      let totalPortion = 0
      for (const item of items) {
        const term = termMap.get(item.paymentTermId)
        if (!term) {
          return NextResponse.json({ error: `Payment term ${item.paymentTermId} not found` }, { status: 400 })
        }
        totalPortion += Number(term.invoicePortion)
      }
      if (Math.abs(totalPortion - 100) > 0.01) {
        return NextResponse.json({ error: `Template portions must sum to 100%. Current sum: ${totalPortion}%` }, { status: 400 })
      }
    }

    const [template] = await db.insert(paymentTermsTemplates).values({
      tenantId: session.user.tenantId,
      name,
    }).returning()

    // Insert template items
    if (items && items.length > 0) {
      await db.insert(paymentTermsTemplateItems).values(
        items.map((item: { paymentTermId: string; sortOrder?: number }, idx: number) => ({
          tenantId: session.user.tenantId,
          templateId: template.id,
          paymentTermId: item.paymentTermId,
          sortOrder: item.sortOrder ?? idx,
        }))
      )
    }

    logAndBroadcast(session.user.tenantId, 'payment-terms-template', 'created', template.id)
    return NextResponse.json(template, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
