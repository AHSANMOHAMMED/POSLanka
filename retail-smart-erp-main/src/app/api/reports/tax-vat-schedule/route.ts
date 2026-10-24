import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import {
  getInputVatSchedule,
  getOutputVatSchedule,
  getVatSummary,
  INPUT_VAT_CSV_COLUMNS,
  OUTPUT_VAT_CSV_COLUMNS,
  toCsv,
} from '@/lib/reports/vat'
import { requireAllBranches } from '@/lib/auth/branch-access'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const querySchema = z.object({
  type: z.enum(['output', 'input', 'summary']).default('summary'),
  fromDate: dateSchema,
  toDate: dateSchema,
  format: z.enum(['json', 'csv']).default('json'),
}).refine((q) => q.fromDate <= q.toDate, { message: 'fromDate must not be after toDate', path: ['toDate'] })

// GET /api/reports/tax-vat-schedule?type=output|input|summary&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD[&format=csv]
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError
    // K4: a company-wide report, not split by branch: refused for branch-restricted users
    const branchError = await requireAllBranches(session)
    if (branchError) return branchError

    const parsed = validateSearchParams(request, querySchema)
    if (!parsed.success) return parsed.response
    const { type, fromDate, toDate, format } = parsed.data
    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      if (type === 'summary') {
        return NextResponse.json(await getVatSummary(db, tenantId, { fromDate, toDate }))
      }
      const result = type === 'output'
        ? await getOutputVatSchedule(db, tenantId, { fromDate, toDate })
        : await getInputVatSchedule(db, tenantId, { fromDate, toDate })
      if (format === 'csv') {
        const csv = toCsv(type === 'output' ? OUTPUT_VAT_CSV_COLUMNS : INPUT_VAT_CSV_COLUMNS, result.rows as unknown as Array<Record<string, unknown>>)
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${type}-vat-schedule-${fromDate}-to-${toDate}.csv"`,
          },
        })
      }
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reports/tax-vat-schedule', error)
    return NextResponse.json({ error: 'Failed to build VAT schedule' }, { status: 500 })
  }
}
