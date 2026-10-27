import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { validateBody } from '@/lib/validation/helpers'
import { hrSettingsSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { loadHrSettings, saveHrSettings } from '@/lib/attendance/settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/settings — tenant HR / attendance settings (tenants.settings.hr) + time zone
export async function GET() {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => NextResponse.json(await loadHrSettings(db, auth.session.user.tenantId)))
  } catch (error) {
    return hrError('api/hr/settings', error, 'Failed to load HR settings')
  }
}

// PUT /api/hr/settings — owner / HR manager (payroll impact)
export async function PUT(request: NextRequest) {
  const auth = await hrAuth('processPayroll')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, hrSettingsSchema, { keepEmptyStrings: true }) // '' clears defaultShiftId
  if (!parsed.success) return parsed.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { settings: current } = await loadHrSettings(db, tenantId)
      const body = parsed.data as Record<string, unknown>
      const next: Record<string, unknown> = { ...current, ...body }
      if (body.attendancePayroll === 'auto') delete next.attendancePayroll
      const saved = await saveHrSettings(db, tenantId, next)
      logAndBroadcast(tenantId, 'attendance', 'updated', 'hr-settings', { userId: auth.session.user.id, description: 'HR attendance settings changed', metadata: saved as unknown as Record<string, unknown> })
      return NextResponse.json({ settings: saved })
    })
  } catch (error) {
    return hrError('api/hr/settings', error, 'Failed to save HR settings')
  }
}
