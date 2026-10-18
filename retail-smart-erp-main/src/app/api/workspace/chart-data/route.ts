import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { getChartKeys, fetchChartData } from '@/lib/workspace/metrics'
import { logError } from '@/lib/ai/error-logger'

// GET chart data for a given chart key
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const key = request.nextUrl.searchParams.get('key')
    if (!key) {
      return NextResponse.json({ error: 'key parameter is required' }, { status: 400 })
    }

    const allowedKeys = getChartKeys()
    if (!allowedKeys.includes(key)) {
      return NextResponse.json({ error: 'Invalid chart key' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const data = await fetchChartData(db, key)
      if (!data) {
        return NextResponse.json({ error: 'Chart data not found' }, { status: 404 })
      }
      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/workspace/chart-data', error)
    return NextResponse.json({ error: 'Failed to fetch chart data' }, { status: 500 })
  }
}
