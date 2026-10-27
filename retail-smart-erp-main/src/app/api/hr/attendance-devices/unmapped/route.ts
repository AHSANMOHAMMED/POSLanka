import { NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { attendanceDevices } from '@/lib/db/schema'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { getBranchScope } from '@/lib/auth/branch-access'
import { listUnmappedUserIds } from '@/lib/attendance/ingest'

// GET /api/hr/attendance-devices/unmapped — device user ids with punches but no employee yet
// (with the name stored on the device, when the device uploaded its user list)
export async function GET() {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const scope = await getBranchScope(auth.session, db)
      const devices = await db.select({ id: attendanceDevices.id, name: attendanceDevices.name, warehouseId: attendanceDevices.warehouseId, deviceInfo: attendanceDevices.deviceInfo }).from(attendanceDevices)
      const byId = new Map(devices.map((d) => [d.id, d]))
      const rows = await listUnmappedUserIds(db)
      const out = rows.filter((r) => {
        if (!scope) return true
        const dev = r.deviceId ? byId.get(r.deviceId) : null
        return !!dev?.warehouseId && scope.includes(dev.warehouseId)
      }).map((r) => {
        const dev = r.deviceId ? byId.get(r.deviceId) : null
        const users = (dev?.deviceInfo as { users?: Record<string, string> } | null)?.users
        return { ...r, deviceName: dev?.name ?? null, nameOnDevice: users?.[r.biometricUserId ?? ''] || null }
      })
      return NextResponse.json(out)
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices/unmapped', error, 'Failed to load unmapped users')
  }
}
