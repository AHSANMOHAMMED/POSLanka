import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendanceDevices, attendancePunches, employeeProfiles, users } from '@/lib/db/schema'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { manualPunchSchema, punchesListSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { ingestPunches } from '@/lib/attendance/ingest'
import { loadHrSettings } from '@/lib/attendance/settings'
import { addDays, daysBetweenInclusive, localToUtc } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/attendance/punches?from&to&employeeProfileId&deviceId — raw punches (max 62 days)
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = validateSearchParams(request, punchesListSchema)
  if (!parsed.success) return parsed.response
  const q = parsed.data
  if (q.to < q.from || daysBetweenInclusive(q.from, q.to) > 62) return NextResponse.json({ error: 'The range must be 1 to 62 days' }, { status: 400 })
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { timezone } = await loadHrSettings(db, tenantId)
      const { ids } = await scopedEmployeeIds(auth.session, db)
      const conds = [
        gte(attendancePunches.punchTime, localToUtc(q.from, '00:00', timezone)),
        lt(attendancePunches.punchTime, localToUtc(addDays(q.to, 1), '00:00', timezone)),
      ]
      if (!q.includeDeleted) conds.push(eq(attendancePunches.isDeleted, false))
      if (q.employeeProfileId) conds.push(eq(attendancePunches.employeeProfileId, q.employeeProfileId))
      if (q.deviceId) conds.push(eq(attendancePunches.deviceId, q.deviceId))
      if (ids) conds.push(inArray(attendancePunches.employeeProfileId, ids.size ? [...ids] : ['00000000-0000-0000-0000-000000000000']))
      const rows = await db.select({
        id: attendancePunches.id,
        employeeProfileId: attendancePunches.employeeProfileId,
        biometricUserId: attendancePunches.biometricUserId,
        punchTime: attendancePunches.punchTime,
        punchType: attendancePunches.punchType,
        verifyMode: attendancePunches.verifyMode,
        source: attendancePunches.source,
        note: attendancePunches.note,
        isDeleted: attendancePunches.isDeleted,
        createdAt: attendancePunches.createdAt,
        deviceName: attendanceDevices.name,
        employeeName: users.fullName,
      }).from(attendancePunches)
        .leftJoin(attendanceDevices, eq(attendanceDevices.id, attendancePunches.deviceId))
        .leftJoin(employeeProfiles, eq(employeeProfiles.id, attendancePunches.employeeProfileId))
        .leftJoin(users, eq(users.id, employeeProfiles.userId))
        .where(and(...conds))
        .orderBy(desc(attendancePunches.punchTime))
        .limit(5000)
      return NextResponse.json({ timezone, data: rows })
    })
  } catch (error) {
    return hrError('api/hr/attendance/punches', error, 'Failed to load punches')
  }
}

// POST /api/hr/attendance/punches — manual punch (missed check-in / out) with a reason; audited
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, manualPunchSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertEmployeeInScope(auth.session, db, d.employeeProfileId)
      if (denied) return denied
      const { timezone } = await loadHrSettings(db, tenantId)
      const punchTime = localToUtc(d.date, d.time, timezone)
      const result = await ingestPunches(db, tenantId, [{
        employeeProfileId: d.employeeProfileId,
        punchTime,
        punchType: d.punchType,
        source: 'manual',
        note: d.note,
        createdBy: auth.session.user.id,
      }], timezone)
      if (result.inserted === 0) return NextResponse.json({ error: 'A punch at this time already exists' }, { status: 409 })
      logAndBroadcast(tenantId, 'attendance', 'created', d.employeeProfileId, {
        userId: auth.session.user.id,
        description: `Manual punch ${d.date} ${d.time} (${d.punchType}): ${d.note}`,
        metadata: { date: d.date, time: d.time, punchType: d.punchType, note: d.note },
      })
      return NextResponse.json({ success: true }, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/attendance/punches', error, 'Failed to add punch')
  }
}
