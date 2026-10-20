import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { tenantAlertSettingsSchema } from '@/lib/validation/schemas/notification-alerts'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { clearAlertSettingsCache, getAlertSettings, saveAlertSettings } from '@/lib/notifications/alert-settings'

// GET /api/notifications/settings — company alert settings (thresholds)
export async function GET() {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    clearAlertSettingsCache(session.user.tenantId)
    return NextResponse.json({ settings: await getAlertSettings(session.user.tenantId) })
  } catch (error) {
    logError('api/notifications/settings GET', error)
    return NextResponse.json({ error: 'Failed to load alert settings' }, { status: 500 })
  }
}

// PUT /api/notifications/settings — replace company alert settings (manageSettings)
export async function PUT(request: NextRequest) {
  const session = await authWithCompany()
  const denied = requirePermission(session, 'manageSettings')
  if (denied || !session) return denied ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await validateBody(request, tenantAlertSettingsSchema)
  if (!parsed.success) return parsed.response
  try {
    const d = parsed.data
    const settings = await saveAlertSettings(session.user.tenantId, {
      defaultMinStock: d.defaultMinStock ?? null,
      expiryWarningDays: d.expiryWarningDays,
      largeRefundAmount: d.largeRefundAmount ?? null,
      varianceThreshold: d.varianceThreshold,
      digestEnabled: d.digestEnabled,
    })
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', 'alerts', {
      userId: session.user.id,
      description: 'Updated alert settings',
    })
    return NextResponse.json({ settings })
  } catch (error) {
    logError('api/notifications/settings PUT', error)
    return NextResponse.json({ error: 'Failed to save alert settings' }, { status: 500 })
  }
}
