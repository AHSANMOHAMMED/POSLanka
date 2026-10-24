import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { FEATURE_FLAGS, type FeatureFlag } from '@/lib/features/flags'

/**
 * GET /api/features/check?flag=… — is this switch on for the caller's business? Used by the proxy
 * (src/proxy.ts) before it lets a request reach a switchable feature's API. No session → "enabled"
 * (the route itself answers 401).
 */
export async function GET(request: NextRequest) {
  const flag = request.nextUrl.searchParams.get('flag') as FeatureFlag | null
  if (!flag || !(FEATURE_FLAGS as readonly string[]).includes(flag)) return NextResponse.json({ error: 'Unknown flag' }, { status: 400 })
  const session = await authWithCompany().catch(() => null)
  if (!session) return NextResponse.json({ enabled: true, authenticated: false })
  const flags = await getTenantFeatureFlags(session.user.tenantId)
  return NextResponse.json({ enabled: flags[flag], authenticated: true, tenantId: session.user.tenantId }, { headers: { 'cache-control': 'no-store' } })
}
