import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getTenantFeatureFlags } from '@/lib/features/check'

export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const flags = await getTenantFeatureFlags(session.user.tenantId)
  return NextResponse.json({ flags })
}
