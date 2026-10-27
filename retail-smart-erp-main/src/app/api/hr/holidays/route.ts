import { NextRequest, NextResponse } from 'next/server'
import { and, asc, gte, lte } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { holidays } from '@/lib/db/schema'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { holidaySchema, holidaysListSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { todayLocal } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/holidays?year=
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = validateSearchParams(request, holidaysListSchema)
  if (!parsed.success) return parsed.response
  const year = parsed.data.year ?? new Date().getFullYear()
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => NextResponse.json(
      await db.select().from(holidays).where(and(gte(holidays.holidayDate, `${year}-01-01`), lte(holidays.holidayDate, `${year}-12-31`))).orderBy(asc(holidays.holidayDate)),
    ))
  } catch (error) {
    return hrError('api/hr/holidays', error, 'Failed to load holidays')
  }
}

// POST /api/hr/holidays
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, holidaySchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [row] = await db.insert(holidays).values({ tenantId, holidayDate: d.holidayDate, name: d.name, isPaid: d.isPaid }).returning()
      const { timezone } = await loadHrSettings(db, tenantId)
      if (d.holidayDate <= todayLocal(timezone)) await recomputeAttendance(db, tenantId, { from: d.holidayDate, to: d.holidayDate })
      logAndBroadcast(tenantId, 'holiday', 'created', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.holidayDate})` })
      return NextResponse.json(row, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/holidays', error, 'Failed to add holiday')
  }
}
