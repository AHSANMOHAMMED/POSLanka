import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { requireModule } from '@/lib/auth/roles'
import { getBranchScope } from '@/lib/auth/branch-access'
import { validateSearchParams } from '@/lib/validation/helpers'
import { serviceJobWarrantyCheckSchema } from '@/lib/validation/schemas/service-jobs'
import { logError } from '@/lib/ai/error-logger'
import { imeiWarning } from '@/lib/utils/imei'
import { SERVICE_JOB_VIEW, checkServiceWarranty, requireAnyPermission } from '@/lib/service-jobs/server'

// GET /api/service-jobs/warranty-check?q= — was this unit (serial / IMEI) sold here, and is it
// still under the shop's warranty? Used while booking a repair. Branch-restricted staff only
// match sales of their own branches.
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, serviceJobWarrantyCheckSchema)
    if (!parsed.success) return parsed.response
    const q = parsed.data.q
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await checkServiceWarranty(db, session.user.tenantId, q, await getBranchScope(session, db))
      const digits = q.replace(/\D/g, '')
      return NextResponse.json({ ...result, imeiWarning: /^[\d\s-]+$/.test(q) && digits.length >= 14 ? imeiWarning(q) : null })
    })
  } catch (error) {
    logError('api/service-jobs/warranty-check', error)
    return NextResponse.json({ error: 'Warranty check failed' }, { status: 500 })
  }
}
