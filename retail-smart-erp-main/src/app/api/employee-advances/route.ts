import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { employeeAdvances, employeeProfiles } from '@/lib/db/schema'
import { eq, and, sql, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { employeeAdvancesListSchema, createEmployeeAdvanceSchema } from '@/lib/validation/schemas/hr'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'approveAdvances')
    if (permError) return permError

    const parsed = validateSearchParams(request, employeeAdvancesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, status, employeeProfileId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) conditions.push(ilike(employeeAdvances.employeeName, `%${escapeLikePattern(search)}%`))
      if (status) conditions.push(eq(employeeAdvances.status, status))
      if (employeeProfileId) conditions.push(eq(employeeAdvances.employeeProfileId, employeeProfileId))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

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
    logError('api/employee-advances', error)
    return NextResponse.json({ error: 'Failed to fetch employee advances' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'approveAdvances')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createEmployeeAdvanceSchema)
    if (!parsed.success) return parsed.response
    const {
      employeeProfileId, requestedAmount, recoveryMethod, recoveryInstallments,
      purpose, reason, notes,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const profile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, employeeProfileId),
        with: { user: true },
      })

      if (!profile) {
        return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 })
      }

      const installmentAmount = Math.round((requestedAmount / recoveryInstallments) * 100) / 100

      // Wrap in transaction with advisory lock for atomic number generation
      const advance = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(6)`)

        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(employeeAdvances)

        const advanceNo = `ADV-${String(Number(count) + 1).padStart(5, '0')}`

        const [result] = await tx
          .insert(employeeAdvances)
          .values({
            tenantId: session.user.tenantId,
            advanceNo,
            employeeProfileId,
            userId: profile.userId,
            employeeName: profile.user.fullName,
            requestedAmount: String(requestedAmount),
            balanceAmount: '0',
            recoveryMethod,
            recoveryInstallments,
            recoveryAmountPerInstallment: String(installmentAmount),
            purpose: purpose || null,
            reason: reason || null,
            status: 'draft',
            requestedAt: new Date(),
            notes: notes || null,
            createdBy: session.user.id,
          })
          .returning()

        return result
      })

      logAndBroadcast(session.user.tenantId, 'employee-advance', 'created', advance.id)

      return NextResponse.json(advance)
    })
  } catch (error) {
    logError('api/employee-advances', error)
    return NextResponse.json({ error: 'Failed to create employee advance' }, { status: 500 })
  }
}
