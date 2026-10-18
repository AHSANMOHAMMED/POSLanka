import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { dunningTypes } from '@/lib/db/schema'
import { ilike, sql, and } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { dunningTypesListSchema, createDunningTypeSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, dunningTypesListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, all, page, pageSize } = qp.data

    const conditions = []
    if (search) conditions.push(ilike(dunningTypes.name, `%${escapeLikePattern(search)}%`))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (all) {
      const data = await db.select().from(dunningTypes).where(where).orderBy(dunningTypes.startDay).limit(1000)
      return NextResponse.json(data)
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(dunningTypes).where(where)
    const data = await db.select().from(dunningTypes).where(where)
      .orderBy(dunningTypes.startDay).limit(pageSize).offset((page - 1) * pageSize)

    return NextResponse.json({ data, pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) } })
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

    const parsed = await validateBody(request, createDunningTypeSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const [dt] = await db.insert(dunningTypes).values({
      tenantId: session.user.tenantId,
      name: body.name,
      startDay: body.startDay,
      endDay: body.endDay,
      dunningFee: String(body.dunningFee),
      interestRate: String(body.interestRate),
      bodyText: body.bodyText || null,
      isActive: body.isActive,
    }).returning()

    logAndBroadcast(session.user.tenantId, 'dunning-type', 'created', dt.id)
    return NextResponse.json(dt, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
