import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { payrollRuns, salarySlips, salarySlipComponents, employeeProfiles } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { computeSalarySlip } from '@/lib/payroll/compute-salary-slip'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { payrollRunsListSchema, createPayrollRunSchema } from '@/lib/validation/schemas/hr'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewPayroll')
    if (permError) return permError

    const parsed = validateSearchParams(request, payrollRunsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, year, status } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (year) conditions.push(eq(payrollRuns.payrollYear, year))
      if (status) conditions.push(eq(payrollRuns.status, status))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(payrollRuns)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.payrollRuns.findMany({
        where: whereClause,
        orderBy: (r, { desc }) => [desc(r.payrollYear), desc(r.payrollMonth), desc(r.createdAt)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/payroll-runs', error)
    return NextResponse.json({ error: 'Failed to fetch payroll runs' }, { status: 500 })
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

    const parsed = await validateBody(request, createPayrollRunSchema)
    if (!parsed.success) return parsed.response
    const {
      payrollMonth,
      payrollYear,
      totalWorkingDays,
      employmentTypes,
      departments,
    } = parsed.data

    return await withTenantTransaction(session.user.tenantId, async (db) => {
      // Generate run number
      const monthStr = String(payrollMonth).padStart(2, '0')
      const [{ count: runCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.payrollYear, payrollYear),
            eq(payrollRuns.payrollMonth, payrollMonth)
          )
        )
      const runNo = `PR-${payrollYear}-${monthStr}-${String(Number(runCount) + 1).padStart(2, '0')}`

      // Create payroll run
      const [run] = await db
        .insert(payrollRuns)
        .values({
          tenantId: session.user.tenantId,
          runNo,
          payrollMonth,
          payrollYear,
          employmentTypes: employmentTypes || null,
          departments: departments || null,
          status: 'draft',
          createdBy: session.user.id,
        })
        .returning()

      // Find eligible employees
      const conditions = [eq(employeeProfiles.employmentStatus, 'active')]
      if (employmentTypes && employmentTypes.length > 0) {
        conditions.push(inArray(employeeProfiles.employmentType, employmentTypes))
      }

      const profiles = await db.query.employeeProfiles.findMany({
        where: and(...conditions),
        with: { user: true },
      })

      // Filter by department if specified
      let eligibleProfiles = profiles
      if (departments && departments.length > 0) {
        eligibleProfiles = profiles.filter((p) =>
          p.department && departments.includes(p.department)
        )
      }

      // Generate salary slips for each eligible employee
      let totalGross = 0
      let totalDed = 0
      let totalEmployer = 0
      let totalNet = 0
      let totalComm = 0
      let slipCount = 0

      for (const profile of eligibleProfiles) {
        // Skip if slip already exists for this period
        const existingSlip = await db.query.salarySlips.findFirst({
          where: and(
            eq(salarySlips.employeeProfileId, profile.id),
            eq(salarySlips.payrollMonth, payrollMonth),
            eq(salarySlips.payrollYear, payrollYear),
          ),
        })

        if (existingSlip && existingSlip.status !== 'cancelled') continue

        try {
          const computed = await computeSalarySlip(db, {
            employeeProfileId: profile.id,
            payrollMonth,
            payrollYear,
            totalWorkingDays,
            paymentDays: totalWorkingDays,
            includeAdvanceRecovery: true,
          })

          slipCount++
          const slipNo = `SAL-${payrollYear}-${monthStr}-${String(slipCount).padStart(3, '0')}`
          const startDate = `${payrollYear}-${monthStr}-01`
          const endDate = new Date(payrollYear, payrollMonth, 0).toISOString().split('T')[0]

          const [slip] = await db
            .insert(salarySlips)
            .values({
              tenantId: session.user.tenantId,
              slipNo,
              employeeProfileId: profile.id,
              userId: profile.userId,
              employeeName: profile.user.fullName,
              payrollMonth,
              payrollYear,
              startDate,
              endDate,
              totalWorkingDays: String(totalWorkingDays),
              paymentDays: String(totalWorkingDays),
              baseSalary: String(computed.baseSalary),
              grossPay: String(computed.grossPay),
              totalDeductions: String(computed.totalDeductions),
              totalEmployerContributions: String(computed.totalEmployerContributions),
              netPay: String(computed.netPay),
              commissionAmount: String(computed.commissionAmount),
              advanceDeduction: String(computed.advanceDeduction),
              salaryStructureId: computed.salaryStructureId,
              salaryStructureName: computed.salaryStructureName,
              payrollRunId: run.id,
              status: 'draft',
              createdBy: session.user.id,
            })
            .returning()

          if (computed.components.length > 0) {
            await db.insert(salarySlipComponents).values(
              computed.components.map((c) => ({
                tenantId: session.user.tenantId,
                salarySlipId: slip.id,
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

          totalGross += computed.grossPay
          totalDed += computed.totalDeductions
          totalEmployer += computed.totalEmployerContributions
          totalNet += computed.netPay
          totalComm += computed.commissionAmount
        } catch (err) {
          logError('api/payroll-runs', err)
        }
      }

      // Update run totals
      const [updatedRun] = await db
        .update(payrollRuns)
        .set({
          totalEmployees: slipCount,
          totalGrossPay: String(Math.round(totalGross * 100) / 100),
          totalDeductions: String(Math.round(totalDed * 100) / 100),
          totalEmployerContributions: String(Math.round(totalEmployer * 100) / 100),
          totalNetPay: String(Math.round(totalNet * 100) / 100),
          totalCommissions: String(Math.round(totalComm * 100) / 100),
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, run.id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'payroll-run', 'created', run.id)

      return NextResponse.json(updatedRun)
    })
  } catch (error) {
    logError('api/payroll-runs', error)
    return NextResponse.json({ error: 'Failed to create payroll run' }, { status: 500 })
  }
}
