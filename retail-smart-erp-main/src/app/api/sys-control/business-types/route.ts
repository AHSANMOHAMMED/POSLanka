import { NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { getBusinessTypeOverview } from '@/lib/admin/business-type-features'

/** GET /api/sys-control/business-types — every business type: vendors, sales, switches on, preset. */
export async function GET() {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    return NextResponse.json(await getBusinessTypeOverview())
  } catch (error) {
    logError('api/sys-control/business-types GET', error)
    return NextResponse.json({ error: 'Failed to load business types' }, { status: 500 })
  }
}
