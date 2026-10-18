import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { payrollRuns, salarySlips } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

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
      const run = await db.query.payrollRuns.findFirst({
        where: eq(payrollRuns.id, id),
      })

      if (!run) {
        return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
      }

      // Get associated salary slips
      const slips = await db.query.salarySlips.findMany({
        where: eq(salarySlips.payrollRunId, id),
        orderBy: (s, { asc }) => [asc(s.employeeName)],
      })

      return NextResponse.json({ ...run, salarySlips: slips })
    })
  } catch (error) {
    logError('api/payroll-runs/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch payroll run' }, { status: 500 })
  }
}
