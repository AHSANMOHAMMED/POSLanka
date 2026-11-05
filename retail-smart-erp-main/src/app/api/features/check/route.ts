import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getTenantEffectiveFeatureFlags } from '@/lib/features/check'
import { FEATURE_FLAGS, type FeatureFlag } from '@/lib/features/flags'

/**
 * GET /api/features/check?flags=a,b (or ?flag=a) — is any of these switches on for the caller's
 * business? Used by the proxy (src/proxy.ts) before it lets a request reach a switchable feature's
 * API. No session → "enabled" (the route itself answers 401).
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('flags') || request.nextUrl.searchParams.get('flag') || ''
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean)
  if (keys.length === 0 || keys.some((k) => !(FEATURE_FLAGS as readonly string[]).includes(k))) {
    return NextResponse.json({ error: 'Unknown flag' }, { status: 400 })
  }
  const session = await authWithCompany().catch(() => null)
  if (!session) return NextResponse.json({ enabled: true, authenticated: false })
  const flags = await getTenantEffectiveFeatureFlags(session.user.tenantId)
  const enabled = (keys as FeatureFlag[]).some((k) => flags[k])
  return NextResponse.json({ enabled, authenticated: true, tenantId: session.user.tenantId }, { headers: { 'cache-control': 'no-store' } })
}
