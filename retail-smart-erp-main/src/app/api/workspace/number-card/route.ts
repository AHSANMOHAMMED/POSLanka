import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { getMetricKeys, fetchMetrics } from '@/lib/workspace/metrics'
import { logError } from '@/lib/ai/error-logger'

// GET number card metric values
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const keysParam = request.nextUrl.searchParams.get('keys')
    if (!keysParam) {
      return NextResponse.json({ error: 'keys parameter is required' }, { status: 400 })
    }

    const requestedKeys = keysParam.split(',').map((k) => k.trim()).filter(Boolean)
    const allowedKeys = getMetricKeys()
    const validKeys = requestedKeys.filter((k) => allowedKeys.includes(k))

    if (validKeys.length === 0) {
      return NextResponse.json({ error: 'No valid metric keys provided' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const results = await fetchMetrics(db, validKeys)
      return NextResponse.json(results)
    })
  } catch (error) {
    logError('api/workspace/number-card', error)
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }
}
