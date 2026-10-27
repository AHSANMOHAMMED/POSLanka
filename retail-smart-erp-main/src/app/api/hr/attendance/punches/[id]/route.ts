import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendancePunches } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { deletePunchSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError } from '@/lib/attendance/api'
import { recomputeForPunches } from '@/lib/attendance/compute'
import { loadHrSettings } from '@/lib/attendance/settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// DELETE /api/hr/attendance/punches/[id]  { note } — soft delete (kept for audit) + recompute the day
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const parsed = await validateBody(request, deletePunchSchema)
  if (!parsed.success) return parsed.response
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [punch] = await db.select().from(attendancePunches).where(eq(attendancePunches.id, p.data.id)).limit(1)
      if (!punch || punch.isDeleted) return NextResponse.json({ error: 'Punch not found' }, { status: 404 })
      if (punch.employeeProfileId) {
        const denied = await assertEmployeeInScope(auth.session, db, punch.employeeProfileId)
        if (denied) return denied
      }
      await db.update(attendancePunches).set({
        isDeleted: true, deletedBy: auth.session.user.id, deletedAt: new Date(),
        note: [punch.note, `Deleted: ${parsed.data.note}`].filter(Boolean).join(' | ').slice(0, 2000),
      }).where(eq(attendancePunches.id, punch.id))
      if (punch.employeeProfileId) {
        const { timezone } = await loadHrSettings(db, tenantId)
        await recomputeForPunches(db, tenantId, new Map([[punch.employeeProfileId, [new Date(punch.punchTime)]]]), timezone)
      }
      logAndBroadcast(tenantId, 'attendance', 'deleted', punch.employeeProfileId ?? punch.id, {
        userId: auth.session.user.id,
        description: `Punch ${new Date(punch.punchTime).toISOString()} removed: ${parsed.data.note}`,
        metadata: { punchId: punch.id, punchTime: punch.punchTime, source: punch.source, note: parsed.data.note },
      })
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    return hrError('api/hr/attendance/punches/[id]', error, 'Failed to delete punch')
  }
}
