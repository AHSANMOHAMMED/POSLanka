import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { loadPharmacySettings, savePharmacySettings } from '@/lib/pharmacy/settings'

/** GET / PUT /api/pharmacy/settings — { expiryAlertDays } (dashboard expiry alert window, default 90) */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const settings = await withTenant(session.user.tenantId, (db) => loadPharmacySettings(db, session.user.tenantId))
    return NextResponse.json(settings)
  } catch (error) {
    logError('api/pharmacy/settings GET', error)
    return NextResponse.json({ error: 'Failed to load pharmacy settings' }, { status: 500 })
  }
}

const schema = z.object({ expiryAlertDays: z.coerce.number().int().min(1).max(730) })

export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError
    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const settings = await withTenant(session.user.tenantId, async (db) => {
      await savePharmacySettings(db, session.user.tenantId, parsed.data)
      return loadPharmacySettings(db, session.user.tenantId)
    })
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'pharmacy', { userId: session.user.id })
    return NextResponse.json(settings)
  } catch (error) {
    logError('api/pharmacy/settings PUT', error)
    return NextResponse.json({ error: 'Failed to save pharmacy settings' }, { status: 500 })
  }
}
