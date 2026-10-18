import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { getQuickListKeys, fetchQuickListData } from '@/lib/workspace/metrics'
import { logError } from '@/lib/ai/error-logger'

// GET quick list data for a given list key
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

    const allowedKeys = getQuickListKeys()
    if (!allowedKeys.includes(key)) {
      return NextResponse.json({ error: 'Invalid quick list key' }, { status: 400 })
    }

    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 5, 1), 50) : 5

    return await withTenant(session.user.tenantId, async (db) => {
      const data = await fetchQuickListData(db, key, limit)
      if (!data) {
        return NextResponse.json({ error: 'Quick list data not found' }, { status: 404 })
      }
      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/workspace/quick-list', error)
    return NextResponse.json({ error: 'Failed to fetch quick list data' }, { status: 500 })
  }
}
