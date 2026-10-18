import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentRequests, tenants } from '@/lib/db/schema'
import { eq, desc, and, ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { paymentRequestsListSchema, createPaymentRequestSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, paymentRequestsListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, status, page, pageSize } = qp.data

    const conditions = []
    if (search) {
      const escaped = escapeLikePattern(search)
      conditions.push(or(
        ilike(paymentRequests.requestNumber, `%${escaped}%`),
        ilike(paymentRequests.emailTo, `%${escaped}%`),
      ))
    }
    if (status) conditions.push(eq(paymentRequests.status, status))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(paymentRequests).where(where)
    const data = await db.select().from(paymentRequests).where(where)
      .orderBy(desc(paymentRequests.createdAt)).limit(pageSize).offset((page - 1) * pageSize)

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
    const parsed = await validateBody(request, createPaymentRequestSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Get tenant's currency as default
    const tenant = await tx
      .select({ currency: tenants.currency })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const tenantCurrency = tenant[0]?.currency || 'LKR'

    // Generate request number
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payment_request_' || ${tenantId}))`)
    const [maxResult] = await tx.select({
      maxNum: sql<string>`COALESCE(MAX(CAST(SUBSTRING(${paymentRequests.requestNumber} FROM 5) AS integer)), 0)`,
    }).from(paymentRequests)
    const requestNumber = `PRQ-${String(Number(maxResult?.maxNum || 0) + 1).padStart(4, '0')}`

    const [pr] = await tx.insert(paymentRequests).values({
      tenantId,
      requestNumber,
      requestType: body.requestType,
      referenceType: body.referenceType,
      referenceId: body.referenceId,
      partyType: body.partyType,
      partyId: body.partyId,
      amount: String(body.amount),
      currency: body.currency || tenantCurrency,
      emailTo: body.emailTo || null,
      subject: body.subject || null,
      message: body.message || null,
      modeOfPaymentId: body.modeOfPaymentId || null,
      createdBy: session.user.id,
    }).returning()

    logAndBroadcast(tenantId, 'payment-request', 'created', pr.id)
    return NextResponse.json(pr, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
