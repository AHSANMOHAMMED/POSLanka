import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { getBranchScope } from '@/lib/auth/branch-access'
import { patientHistory } from '@/lib/pharmacy/history'
import { requireAnyPermission, uuidParam } from '@/lib/pharmacy/route-helpers'

/**
 * GET /api/pharmacy/patients/history?customerId= | ?phone= | ?name=  [&all=1] — medicines
 * dispensed to this patient (newest first) with the doctor; all=1 includes non-medicine lines.
 * Branch-restricted staff see the bills of their own branches.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'viewReports'])
    if (permError) return permError
    const sp = request.nextUrl.searchParams
    const customerId = uuidParam(sp, 'customerId')
    const phone = sp.get('phone')?.slice(0, 50) || null
    const name = sp.get('name')?.slice(0, 255) || null
    if (!customerId && !phone && !name) return NextResponse.json({ error: 'customerId, phone or name is required' }, { status: 400 })
    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const data = await patientHistory(db, {
        tenantId: session.user.tenantId, customerId, phone, name, medicinesOnly: sp.get('all') !== '1', scope,
      })
      return NextResponse.json({ data })
    })
  } catch (error) {
    logError('api/pharmacy/patients/history', error)
    return NextResponse.json({ error: 'Failed to load the medication history' }, { status: 500 })
  }
}
