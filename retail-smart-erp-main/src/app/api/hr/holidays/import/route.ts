import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { holidays } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { importHolidaysSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { todayLocal } from '@/lib/attendance/time'
import { SRI_LANKA_HOLIDAYS, SRI_LANKA_HOLIDAYS_VERIFIED } from '@/lib/attendance/sri-lanka-holidays'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// POST /api/hr/holidays/import { year, includePoya } — Sri Lanka public holidays (static list,
// must be checked against the gazette); dates that already have a holiday are left alone
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, importHolidaysSchema)
  if (!parsed.success) return parsed.response
  const list = (SRI_LANKA_HOLIDAYS[parsed.data.year] ?? []).filter((h) => parsed.data.includePoya || !h.poya)
  if (list.length === 0) return NextResponse.json({ error: 'No holiday list for this year' }, { status: 404 })
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const rows = await db.insert(holidays).values(list.map((h) => ({ tenantId, holidayDate: h.date, name: h.name, isPaid: true })))
        .onConflictDoNothing().returning({ holidayDate: holidays.holidayDate })
      const { timezone } = await loadHrSettings(db, tenantId)
      const today = todayLocal(timezone)
      const past = rows.map((r) => r.holidayDate).filter((d) => d <= today).sort()
      if (past.length > 0) await recomputeAttendance(db, tenantId, { from: past[0], to: past[past.length - 1] })
      logAndBroadcast(tenantId, 'holiday', 'created', 'import', { userId: auth.session.user.id, description: `Imported ${rows.length} Sri Lanka holidays for ${parsed.data.year}` })
      return NextResponse.json({ imported: rows.length, skipped: list.length - rows.length, verified: SRI_LANKA_HOLIDAYS_VERIFIED })
    })
  } catch (error) {
    return hrError('api/hr/holidays/import', error, 'Failed to import holidays')
  }
}
