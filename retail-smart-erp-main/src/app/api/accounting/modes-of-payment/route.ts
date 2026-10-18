import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { modesOfPayment, chartOfAccounts } from '@/lib/db/schema'
import { eq, asc, ilike, and, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { modesOfPaymentListSchema, createModeOfPaymentSchema } from '@/lib/validation/schemas/accounting'

function attachAccount(rows: { accountId: string | null; accountName: string | null; accountNumber: string | null }[]) {
  return rows.map(({ accountId, accountName, accountNumber, ...rest }) => ({
    ...rest,
    account: accountId ? { id: accountId, name: accountName!, accountNumber: accountNumber! } : null,
  }))
}

export async function GET(request: NextRequest) {
  const qp = validateSearchParams(request, modesOfPaymentListSchema)
  if (!qp.success) return qp.response

  const result = await withAuthTenant(async (session, db) => {
    const { search, all, enabled: enabledOnly } = qp.data

    const conditions = []
    if (search) {
      conditions.push(ilike(modesOfPayment.name, `%${escapeLikePattern(search)}%`))
    }
    if (enabledOnly) {
      conditions.push(eq(modesOfPayment.isEnabled, true))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const selectFields = {
      id: modesOfPayment.id,
      tenantId: modesOfPayment.tenantId,
      name: modesOfPayment.name,
      type: modesOfPayment.type,
      methodKey: modesOfPayment.methodKey,
      defaultAccountId: modesOfPayment.defaultAccountId,
      isEnabled: modesOfPayment.isEnabled,
      sortOrder: modesOfPayment.sortOrder,
      createdAt: modesOfPayment.createdAt,
      updatedAt: modesOfPayment.updatedAt,
      accountId: chartOfAccounts.id,
      accountName: chartOfAccounts.name,
      accountNumber: chartOfAccounts.accountNumber,
    }

    const baseQuery = db
      .select(selectFields)
      .from(modesOfPayment)
      .leftJoin(chartOfAccounts, eq(modesOfPayment.defaultAccountId, chartOfAccounts.id))

    if (all) {
      const rows = await baseQuery.where(where).orderBy(asc(modesOfPayment.sortOrder), asc(modesOfPayment.name)).limit(1000)
      return NextResponse.json(attachAccount(rows))
    }

    const { page, pageSize } = qp.data

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(modesOfPayment).where(where)
    const rows = await baseQuery.where(where).orderBy(asc(modesOfPayment.sortOrder), asc(modesOfPayment.name)).limit(pageSize).offset((page - 1) * pageSize)

    return NextResponse.json({
      data: attachAccount(rows),
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

    const parsed = await validateBody(request, createModeOfPaymentSchema)
    if (!parsed.success) return parsed.response
    const { name, type, methodKey, defaultAccountId, isEnabled, sortOrder } = parsed.data

    const [mode] = await db.insert(modesOfPayment).values({
      tenantId: session.user.tenantId,
      name,
      type,
      methodKey: methodKey || null,
      defaultAccountId,
      isEnabled,
      sortOrder,
    }).returning()

    logAndBroadcast(session.user.tenantId, 'mode-of-payment', 'created', mode.id)
    return NextResponse.json(mode, { status: 201 })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
