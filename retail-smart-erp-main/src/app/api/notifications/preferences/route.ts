import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { notificationPreferences } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { alertPreferencesSchema } from '@/lib/validation/schemas/notification-alerts'
import { logError } from '@/lib/ai/error-logger'
import { ALERT_TYPES, ALERT_TYPE_INFO } from '@/lib/notifications/alert-types'
import { getTenantTimezone, isValidTimezone, toPreferences } from '@/lib/notifications/alert-settings'

const catalogue = ALERT_TYPES.map((type) => ({ type, ...ALERT_TYPE_INFO[type] }))

// GET /api/notifications/preferences — my alert preferences (defaults when never saved)
export async function GET() {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const tenantId = session.user.tenantId
    const [row] = await withTenant(tenantId, (tdb) => tdb.select().from(notificationPreferences)
      .where(eq(notificationPreferences.userId, session.user.id)).limit(1))
    return NextResponse.json({
      preferences: toPreferences(row),
      saved: !!row,
      tenantTimezone: await getTenantTimezone(tenantId),
      types: catalogue,
    })
  } catch (error) {
    logError('api/notifications/preferences GET', error)
    return NextResponse.json({ error: 'Failed to load alert preferences' }, { status: 500 })
  }
}

// PUT /api/notifications/preferences — replace my alert preferences
export async function PUT(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await validateBody(request, alertPreferencesSchema)
  if (!parsed.success) return parsed.response
  const p = parsed.data
  if (p.timezone && !isValidTimezone(p.timezone)) {
    return NextResponse.json({ error: 'Unknown timezone' }, { status: 400 })
  }
  try {
    const tenantId = session.user.tenantId
    const values = {
      tenantId,
      enabledTypes: p.enabledTypes ?? null,
      mutedTypes: [...new Set(p.mutedTypes)],
      quietStart: p.quietStart ?? null,
      quietEnd: p.quietEnd ?? null,
      timezone: p.timezone || null,
      digestHour: p.digestHour ?? null,
      pushEnabled: p.pushEnabled,
      updatedAt: new Date(),
    }
    const [row] = await withTenant(tenantId, (tdb) => tdb.insert(notificationPreferences)
      .values({ userId: session.user.id, ...values })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: values })
      .returning())
    return NextResponse.json({ preferences: toPreferences(row), saved: true })
  } catch (error) {
    logError('api/notifications/preferences PUT', error)
    return NextResponse.json({ error: 'Failed to save alert preferences' }, { status: 500 })
  }
}
