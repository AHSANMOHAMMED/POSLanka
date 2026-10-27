import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salarySlips, salarySlipComponents, payrollRuns } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { computeSalarySlip } from '@/lib/payroll/compute-salary-slip'
import { attendanceFormulaVariables, type AttendancePayrollSummary } from '@/lib/attendance/payroll'

function attendanceVariablesOf(summary: unknown): Record<string, number> | undefined {
  const s = summary as AttendancePayrollSummary | null
  if (!s || s.source !== 'attendance') return undefined
  // payment / working days follow the edited values (computeSalarySlip defaults them)
  const vars = attendanceFormulaVariables(s)
  delete vars.payment_days
  delete vars.working_days
  delete vars.absent_days
  return vars
}
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSalarySlipSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { SAFE_USER } from '@/lib/db/safe-columns'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewPayroll')
    if (permError) return permError

    return await withTenant(session.user.tenantId, async (db) => {
      const slip = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, id),
        with: {
          components: { orderBy: (c, { asc }) => [asc(c.sortOrder)] },
          employeeProfile: { with: { user: SAFE_USER } },
        },
      })

      if (!slip) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      return NextResponse.json(slip)
    })
  } catch (error) {
    logError('api/salary-slips/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch salary slip' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'processPayroll')
    if (permError) return permError

    const parsed = await validateBody(request, updateSalarySlipSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.salarySlips.findFirst({
        where: eq(salarySlips.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      if (existing.status !== 'draft') {
        return NextResponse.json({ error: 'Only draft slips can be edited' }, { status: 400 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (body.totalWorkingDays !== undefined) updateData.totalWorkingDays = String(body.totalWorkingDays)
      if (body.paymentDays !== undefined) updateData.paymentDays = String(body.paymentDays)
      if (body.paymentMethod !== undefined) updateData.paymentMethod = body.paymentMethod
      if (body.paymentReference !== undefined) updateData.paymentReference = body.paymentReference

      // Changing the days must re-prorate the pay: saving "20 of 30 days" while keeping the
      // full-month amounts paid the employee for days not worked.
      const totalWorkingDays = body.totalWorkingDays !== undefined ? Number(body.totalWorkingDays) : Number(existing.totalWorkingDays)
      const paymentDays = body.paymentDays !== undefined ? Number(body.paymentDays) : Number(existing.paymentDays)
      const daysChanged = totalWorkingDays !== Number(existing.totalWorkingDays) || paymentDays !== Number(existing.paymentDays)
      let recomputed: Awaited<ReturnType<typeof computeSalarySlip>> | null = null
      if (daysChanged) {
        try {
          recomputed = await computeSalarySlip(db, {
            employeeProfileId: existing.employeeProfileId,
            payrollMonth: existing.payrollMonth,
            payrollYear: existing.payrollYear,
            totalWorkingDays,
            paymentDays,
            commissionAmount: Number(existing.commissionAmount) || 0,
            includeAdvanceRecovery: true,
            // Keep the attendance figures (OT amount, late minutes …) the slip was created with
            extraVariables: attendanceVariablesOf(existing.attendanceSummary),
          })
        } catch (computeError) {
          return NextResponse.json({ error: computeError instanceof Error ? computeError.message : 'Could not compute salary' }, { status: 400 })
        }
        Object.assign(updateData, {
          baseSalary: String(recomputed.baseSalary),
          grossPay: String(recomputed.grossPay),
          totalDeductions: String(recomputed.totalDeductions),
          totalEmployerContributions: String(recomputed.totalEmployerContributions),
          netPay: String(recomputed.netPay),
          advanceDeduction: String(recomputed.advanceDeduction),
          salaryStructureId: recomputed.salaryStructureId,
          salaryStructureName: recomputed.salaryStructureName,
        })
      }

      const [updated] = await db
        .update(salarySlips)
        .set(updateData)
        .where(and(eq(salarySlips.id, id), eq(salarySlips.status, 'draft')))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Only draft slips can be edited' }, { status: 400 })
      }

      if (recomputed) {
        await db.delete(salarySlipComponents).where(eq(salarySlipComponents.salarySlipId, id))
        if (recomputed.components.length > 0) {
          await db.insert(salarySlipComponents).values(
            recomputed.components.map((c) => ({
              tenantId: session.user.tenantId,
              salarySlipId: id,
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
        // Keep the payroll run's totals in step with the edited slip
        if (existing.payrollRunId) {
          const d = (a: unknown, b: unknown) => ((Math.round((Number(a) || 0) * 100) - Math.round((Number(b) || 0) * 100)) / 100).toFixed(2)
          await db.update(payrollRuns).set({
            totalGrossPay: sql`${payrollRuns.totalGrossPay} + ${d(recomputed.grossPay, existing.grossPay)}`,
            totalDeductions: sql`${payrollRuns.totalDeductions} + ${d(recomputed.totalDeductions, existing.totalDeductions)}`,
            totalEmployerContributions: sql`${payrollRuns.totalEmployerContributions} + ${d(recomputed.totalEmployerContributions, existing.totalEmployerContributions)}`,
            totalNetPay: sql`${payrollRuns.totalNetPay} + ${d(recomputed.netPay, existing.netPay)}`,
            updatedAt: new Date(),
          }).where(eq(payrollRuns.id, existing.payrollRunId))
        }
      }

      logAndBroadcast(session.user.tenantId, 'salary-slip', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/salary-slips/[id]', error)
    return NextResponse.json({ error: 'Failed to update salary slip' }, { status: 500 })
  }
}
