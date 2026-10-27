import { NextRequest, NextResponse } from 'next/server'
import { and, eq, ne } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { employeeProfiles } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { mapBiometricSchema } from '@/lib/validation/schemas/attendance'
import { assertEmployeeInScope, hrAuth, hrError } from '@/lib/attendance/api'
import { mapUnmappedPunches, normalizeBiometricId } from '@/lib/attendance/ingest'
import { loadHrSettings } from '@/lib/attendance/settings'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// POST /api/hr/attendance-devices/map { biometricUserId, employeeProfileId } — set the employee's
// fingerprint user id and attach the earlier punches of that id
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, mapBiometricSchema)
  if (!parsed.success) return parsed.response
  const bio = normalizeBiometricId(parsed.data.biometricUserId)!
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const denied = await assertEmployeeInScope(auth.session, db, parsed.data.employeeProfileId)
      if (denied) return denied
      const [taken] = await db.select({ id: employeeProfiles.id }).from(employeeProfiles)
        .where(and(eq(employeeProfiles.biometricUserId, bio), ne(employeeProfiles.id, parsed.data.employeeProfileId))).limit(1)
      if (taken) return NextResponse.json({ error: `Fingerprint user id ${bio} already belongs to another employee`, code: 'DUPLICATE', field: 'biometricUserId' }, { status: 409 })
      const [emp] = await db.update(employeeProfiles).set({ biometricUserId: bio, updatedAt: new Date() })
        .where(eq(employeeProfiles.id, parsed.data.employeeProfileId)).returning({ id: employeeProfiles.id })
      if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      const { timezone } = await loadHrSettings(db, tenantId)
      const attached = await mapUnmappedPunches(db, tenantId, bio, emp.id, timezone)
      logAndBroadcast(tenantId, 'employee-profile', 'updated', emp.id, { userId: auth.session.user.id, description: `Fingerprint user id ${bio} mapped (${attached} punches attached)` })
      return NextResponse.json({ attached })
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices/map', error, 'Failed to map user id')
  }
}
