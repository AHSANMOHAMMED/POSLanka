import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant, type TenantDb } from '@/lib/db'
import { holidays } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateHolidaySchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeAttendance } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { todayLocal } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

async function recomputeDates(db: TenantDb, tenantId: string, dates: string[]) {
  const { timezone } = await loadHrSettings(db, tenantId)
  const today = todayLocal(timezone)
  for (const d of new Set(dates)) if (d <= today) await recomputeAttendance(db, tenantId, { from: d, to: d })
}

// PUT /api/hr/holidays/[id]
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, updateHolidaySchema)
  if (!parsed.success) return parsed.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [current] = await db.select().from(holidays).where(eq(holidays.id, p.data.id)).limit(1)
      if (!current) return NextResponse.json({ error: 'Holiday not found' }, { status: 404 })
      const [row] = await db.update(holidays).set(parsed.data).where(eq(holidays.id, current.id)).returning()
      await recomputeDates(db, tenantId, [current.holidayDate, row.holidayDate])
      logAndBroadcast(tenantId, 'holiday', 'updated', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.holidayDate})` })
      return NextResponse.json(row)
    })
  } catch (error) {
    return hrError('api/hr/holidays/[id]', error, 'Failed to update holiday')
  }
}

// DELETE /api/hr/holidays/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [row] = await db.delete(holidays).where(eq(holidays.id, p.data.id)).returning()
      if (!row) return NextResponse.json({ error: 'Holiday not found' }, { status: 404 })
      await recomputeDates(db, tenantId, [row.holidayDate])
      logAndBroadcast(tenantId, 'holiday', 'deleted', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.holidayDate})` })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/holidays/[id]', error, 'Failed to delete holiday')
  }
}
