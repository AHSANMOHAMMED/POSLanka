import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getTenantEffectiveFeatureFlags } from '@/lib/features/check'

/** GET /api/features — the switches this business really gets (web menus / guard, POS, mobile app) */
export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const flags = await getTenantEffectiveFeatureFlags(session.user.tenantId)
  return NextResponse.json({ flags }, { headers: { 'cache-control': 'no-store' } })
}
