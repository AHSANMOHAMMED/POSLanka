import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { getBusinessTypeDetail, isBusinessType } from '@/lib/admin/business-type-features'

/** GET /api/sys-control/business-types/[type] — the type's vendors × features, with 30-day usage. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const { type } = await params
    if (!isBusinessType(type)) return NextResponse.json({ error: 'Unknown business type' }, { status: 404 })
    return NextResponse.json(await getBusinessTypeDetail(type))
  } catch (error) {
    logError('api/sys-control/business-types/[type] GET', error)
    return NextResponse.json({ error: 'Failed to load business type' }, { status: 500 })
  }
}
