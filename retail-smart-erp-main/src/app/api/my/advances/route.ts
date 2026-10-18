import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { employeeAdvances, employeeProfiles } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { myAdvancesListSchema, createMyAdvanceSchema } from '@/lib/validation/schemas/hr'

// GET current user's advances
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'requestAdvance')
    if (permError) return permError

    const parsed = validateSearchParams(request, myAdvancesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const whereClause = eq(employeeAdvances.userId, session.user.id)

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(employeeAdvances)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.employeeAdvances.findMany({
        where: whereClause,
        orderBy: (a, { desc }) => [desc(a.createdAt)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/my/advances', error)
    return NextResponse.json({ error: 'Failed to fetch advances' }, { status: 500 })
  }
}

// POST - Request advance (own)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'requestAdvance')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createMyAdvanceSchema)
    if (!parsed.success) return parsed.response
    const { requestedAmount, recoveryMethod, recoveryInstallments, purpose, reason } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Find own employee profile
      const profile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.userId, session.user.id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'No employee profile found for your account' }, { status: 404 })
      }

      // Generate advance number
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(employeeAdvances)

      const advanceNo = `ADV-${String(Number(count) + 1).padStart(5, '0')}`
      const installmentAmount = Math.round((requestedAmount / recoveryInstallments) * 100) / 100

      const [advance] = await db
        .insert(employeeAdvances)
        .values({
          tenantId: session.user.tenantId,
          advanceNo,
          employeeProfileId: profile.id,
          userId: session.user.id,
          employeeName: session.user.name || 'Unknown',
          requestedAmount: String(requestedAmount),
          balanceAmount: '0',
          recoveryMethod,
          recoveryInstallments,
          recoveryAmountPerInstallment: String(installmentAmount),
          purpose: purpose || null,
          reason: reason || null,
          status: 'pending_approval',
          requestedAt: new Date(),
          createdBy: session.user.id,
        })
        .returning()

      logAndBroadcast(session.user.tenantId, 'employee-advance', 'created', advance.id)

      return NextResponse.json(advance)
    })
  } catch (error) {
    logError('api/my/advances', error)
    return NextResponse.json({ error: 'Failed to request advance' }, { status: 500 })
  }
}
