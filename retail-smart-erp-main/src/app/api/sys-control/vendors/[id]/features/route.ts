import { NextRequest, NextResponse } from 'next/server'
import { validateAdminSession, adminAudit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { getTenantFeatureFlags, setTenantFeatureFlags } from '@/lib/features/check'
import { normalizeFeatureFlags, type FeatureFlagsMap } from '@/lib/features/flags'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const flags = await getTenantFeatureFlags(id)
    return NextResponse.json({ featureFlags: flags })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/features GET', error)
    return NextResponse.json({ error: 'Failed to load features' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params
    const body = await request.json()
    const flags = normalizeFeatureFlags(body.featureFlags as Partial<FeatureFlagsMap>)
    const next = await setTenantFeatureFlags(id, flags)

    await adminAudit.update(session.superAdminId, 'tenant_feature_flags', id, {
      featureFlags: next,
    })

    return NextResponse.json({ featureFlags: next })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/features PUT', error)
    return NextResponse.json({ error: 'Failed to update features' }, { status: 500 })
  }
}
