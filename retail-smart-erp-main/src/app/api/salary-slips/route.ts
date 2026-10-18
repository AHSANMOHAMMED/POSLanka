import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salarySlips, salarySlipComponents, employeeProfiles } from '@/lib/db/schema'
import { eq, and, sql, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { computeSalarySlip } from '@/lib/payroll/compute-salary-slip'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { salarySlipsListSchema, createSalarySlipSchema } from '@/lib/validation/schemas/hr'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewPayroll')
    if (permError) return permError

    const parsed = validateSearchParams(request, salarySlipsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, month, year, status, employeeProfileId, payrollRunId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) conditions.push(ilike(salarySlips.employeeName, `%${escapeLikePattern(search)}%`))
      if (month) conditions.push(eq(salarySlips.payrollMonth, month))
      if (year) conditions.push(eq(salarySlips.payrollYear, year))
      if (status) conditions.push(eq(salarySlips.status, status))
      if (employeeProfileId) conditions.push(eq(salarySlips.employeeProfileId, employeeProfileId))
      if (payrollRunId) conditions.push(eq(salarySlips.payrollRunId, payrollRunId))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(salarySlips)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.salarySlips.findMany({
        where: whereClause,
        orderBy: (s, { desc }) => [desc(s.payrollYear), desc(s.payrollMonth), desc(s.createdAt)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/salary-slips', error)
    return NextResponse.json({ error: 'Failed to fetch salary slips' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'processPayroll')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createSalarySlipSchema)
    if (!parsed.success) return parsed.response
    const {
      employeeProfileId,
      payrollMonth,
      payrollYear,
      totalWorkingDays,
      paymentDays,
      commissionAmount,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Load employee profile with user
      const profile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, employeeProfileId),
        with: { user: true },
      })

      if (!profile) {
        return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 })
      }

      // Check for duplicate slip
      const existingSlip = await db.query.salarySlips.findFirst({
        where: and(
          eq(salarySlips.employeeProfileId, employeeProfileId),
          eq(salarySlips.payrollMonth, payrollMonth),
          eq(salarySlips.payrollYear, payrollYear),
          // Only check non-cancelled slips
        ),
      })

      if (existingSlip && existingSlip.status !== 'cancelled') {
        return NextResponse.json(
          { error: `Salary slip already exists for ${payrollMonth}/${payrollYear}` },
          { status: 400 }
        )
      }

      // Compute salary
      const computed = await computeSalarySlip(db, {
        employeeProfileId,
        payrollMonth,
        payrollYear,
        totalWorkingDays,
        paymentDays,
        commissionAmount,
        includeAdvanceRecovery: true,
      })

      // Wrap in transaction with advisory lock for atomic number generation
      const monthStr = String(payrollMonth).padStart(2, '0')
      const startDate = `${payrollYear}-${monthStr}-01`
      const endDate = new Date(payrollYear, payrollMonth, 0).toISOString().split('T')[0]

      const slip = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7)`)

        const [{ count: slipCount }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(salarySlips)
          .where(
            and(
              eq(salarySlips.payrollYear, payrollYear),
              eq(salarySlips.payrollMonth, payrollMonth)
            )
          )
        const slipNo = `SAL-${payrollYear}-${monthStr}-${String(Number(slipCount) + 1).padStart(3, '0')}`

        const [newSlip] = await tx
          .insert(salarySlips)
          .values({
            tenantId: session.user.tenantId,
            slipNo,
            employeeProfileId,
            userId: profile.userId,
            employeeName: profile.user.fullName,
            payrollMonth,
            payrollYear,
            startDate,
            endDate,
            totalWorkingDays: String(totalWorkingDays),
            paymentDays: String(paymentDays),
            baseSalary: String(computed.baseSalary),
            grossPay: String(computed.grossPay),
            totalDeductions: String(computed.totalDeductions),
            totalEmployerContributions: String(computed.totalEmployerContributions),
            netPay: String(computed.netPay),
            commissionAmount: String(computed.commissionAmount),
            advanceDeduction: String(computed.advanceDeduction),
            salaryStructureId: computed.salaryStructureId,
            salaryStructureName: computed.salaryStructureName,
            status: 'draft',
            createdBy: session.user.id,
          })
          .returning()

        // Create slip components
        if (computed.components.length > 0) {
          await tx.insert(salarySlipComponents).values(
            computed.components.map((c) => ({
              tenantId: session.user.tenantId,
              salarySlipId: newSlip.id,
              componentId: c.componentId,
              componentName: c.componentName,
              componentType: c.componentType,
              abbreviation: c.abbreviation,
              formulaUsed: c.formulaUsed,
              amount: String(c.amount),
              isStatutory: c.isStatutory,
              doNotIncludeInTotal: c.doNotIncludeInTotal,
              isPayableByEmployer: c.isPayableByEmployer,
              sortOrder: c.sortOrder,
            }))
          )
        }

        return newSlip
      })

      // Fetch complete slip
      const result = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, slip.id),
        with: { components: true },
      })

      logAndBroadcast(session.user.tenantId, 'salary-slip', 'created', slip.id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/salary-slips', error)
    return NextResponse.json({ error: 'Failed to create salary slip' }, { status: 500 })
  }
}
