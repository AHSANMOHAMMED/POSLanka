import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getSalesByItem } from '@/lib/reports/sales'
import { logError } from '@/lib/ai/error-logger'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewReports')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')
    const categoryId = searchParams.get('categoryId')

    // Validate UUID format for optional ID params
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (categoryId && !UUID_RE.test(categoryId)) {
      return NextResponse.json({ error: 'Invalid categoryId format' }, { status: 400 })
    }

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await getSalesByItem(db, session.user.tenantId, {
        fromDate,
        toDate,
        categoryId: categoryId || undefined,
      })
      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reports/sales-by-item', error)
    return NextResponse.json({ error: 'Failed to fetch sales by item' }, { status: 500 })
  }
}
