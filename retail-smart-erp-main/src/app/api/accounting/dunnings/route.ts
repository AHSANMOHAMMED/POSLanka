import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { dunnings, dunningTypes, customers, sales } from '@/lib/db/schema'
import { eq, desc, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { dunningsListSchema, createDunningSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, dunningsListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, status, customerId, page, pageSize } = qp.data

    const conditions = []
    if (search) {
      conditions.push(or(
        ilike(dunnings.dunningNumber, `%${escapeLikePattern(search)}%`),
      ))
    }
    if (status) conditions.push(eq(dunnings.status, status))
    if (customerId) conditions.push(eq(dunnings.customerId, customerId))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(dunnings).where(where)
    const data = await db.select({
      id: dunnings.id,
      dunningNumber: dunnings.dunningNumber,
      dunningTypeId: dunnings.dunningTypeId,
      customerId: dunnings.customerId,
      saleId: dunnings.saleId,
      outstandingAmount: dunnings.outstandingAmount,
      dunningFee: dunnings.dunningFee,
      dunningInterest: dunnings.dunningInterest,
      grandTotal: dunnings.grandTotal,
      status: dunnings.status,
      sentAt: dunnings.sentAt,
      createdAt: dunnings.createdAt,
      dunningTypeName: dunningTypes.name,
      customerName: customers.name,
    })
      .from(dunnings)
      .leftJoin(dunningTypes, eq(dunnings.dunningTypeId, dunningTypes.id))
      .leftJoin(customers, eq(dunnings.customerId, customers.id))
      .where(where)
      .orderBy(desc(dunnings.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({ data, pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) } })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function POST(request: NextRequest) {
  const result = await withAuthTenantTransaction(async (session, tx) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const tenantId = session.user.tenantId
    const parsed = await validateBody(request, createDunningSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Generate dunning number
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('dunning_' || ${tenantId}))`)
    const [maxResult] = await tx.select({
      maxNum: sql<string>`COALESCE(MAX(CAST(SUBSTRING(${dunnings.dunningNumber} FROM 5) AS integer)), 0)`,
    }).from(dunnings)
    const dunningNumber = `DUN-${String(Number(maxResult?.maxNum || 0) + 1).padStart(4, '0')}`

    // Get sale outstanding
    const [sale] = await tx.select().from(sales).where(eq(sales.id, body.saleId))
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    const outstandingAmount = Math.round((Number(sale.total) - Number(sale.paidAmount)) * 100) / 100

    // Get dunning type for fee/interest
    const [dt] = await tx.select().from(dunningTypes).where(eq(dunningTypes.id, body.dunningTypeId))
    const dunningFee = dt ? Number(dt.dunningFee) : 0
    const interestRate = dt ? Number(dt.interestRate) : 0
    const dunningInterest = Math.round((outstandingAmount * interestRate / 100 / 365 * (dt?.endDay || 30)) * 100) / 100
    const grandTotal = Math.round((outstandingAmount + dunningFee + dunningInterest) * 100) / 100

    const [dunning] = await tx.insert(dunnings).values({
      tenantId,
      dunningNumber,
      dunningTypeId: body.dunningTypeId,
      customerId: body.customerId,
      saleId: body.saleId,
      outstandingAmount: String(outstandingAmount),
      dunningFee: String(dunningFee),
      dunningInterest: String(dunningInterest),
      grandTotal: String(grandTotal),
      status: 'draft',
      createdBy: session.user.id,
    }).returning()

    logAndBroadcast(tenantId, 'dunning', 'created', dunning.id)
    return NextResponse.json(dunning, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
