import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { attendanceDevices, warehouses } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { attendanceDeviceSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { branchFilter, getBranchScope, resolveRecordBranch } from '@/lib/auth/branch-access'
import { safeTimezone } from '@/lib/attendance/time'
import { invalidateIclockDevice } from '@/lib/attendance/iclock-server'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/hr/attendance-devices — devices (branch-scoped) with punch counts and online state
export async function GET() {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const scope = await getBranchScope(auth.session, db)
      const rows = await db.select({
        device: attendanceDevices,
        warehouseName: warehouses.name,
        punches: sql<number>`(SELECT count(*)::int FROM attendance_punches p WHERE p.device_id = ${attendanceDevices.id})`,
        unmapped: sql<number>`(SELECT count(*)::int FROM attendance_punches p WHERE p.device_id = ${attendanceDevices.id} AND p.employee_profile_id IS NULL AND p.is_deleted = false)`,
        lastPunchAt: sql<string | null>`(SELECT max(p.punch_time) FROM attendance_punches p WHERE p.device_id = ${attendanceDevices.id})`,
      }).from(attendanceDevices)
        .leftJoin(warehouses, eq(warehouses.id, attendanceDevices.warehouseId))
        .where(and(branchFilter(scope, attendanceDevices.warehouseId)))
        .orderBy(asc(attendanceDevices.name))
      return NextResponse.json(rows.map((r) => {
        const { commKey: _commKey, ...device } = r.device
        void _commKey
        return {
          ...device,
          hasCommKey: !!r.device.commKey,
          warehouseName: r.warehouseName,
          punches: r.punches,
          unmapped: r.unmapped,
          lastPunchAt: r.lastPunchAt,
          online: !!r.device.lastSeenAt && Date.now() - new Date(r.device.lastSeenAt).getTime() < 5 * 60_000,
        }
      }))
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices', error, 'Failed to load devices')
  }
}

// POST /api/hr/attendance-devices — register a device by its serial number
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, attendanceDeviceSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const branch = await resolveRecordBranch(auth.session, db, d.warehouseId)
      if (branch.error) return branch.error
      // Serials are unique across all businesses (the serial is how a device finds its business).
      // The check runs on RLS-visible rows only; the unique index catches another tenant's device.
      try {
        const [row] = await db.insert(attendanceDevices).values({
          tenantId,
          name: d.name,
          serialNumber: d.serialNumber.trim().toUpperCase(),
          warehouseId: branch.warehouseId,
          model: d.model || null,
          commKey: d.commKey || null,
          timezone: safeTimezone(d.timezone),
          isActive: d.isActive ?? true,
          createdBy: auth.session.user.id,
        }).returning()
        await db.execute(sql`DELETE FROM attendance_pending_devices WHERE upper(serial_number) = ${row.serialNumber}`).catch(() => undefined)
        invalidateIclockDevice(row.serialNumber)
        logAndBroadcast(tenantId, 'attendance-device', 'created', row.id, { userId: auth.session.user.id, entityName: `${row.name} (${row.serialNumber})` })
        return NextResponse.json(row, { status: 201 })
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') {
          return NextResponse.json({ error: 'This serial number is already registered (here or by another business). Contact support if this is your device.', code: 'DUPLICATE', field: 'serialNumber' }, { status: 409 })
        }
        throw err
      }
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices', error, 'Failed to register device')
  }
}
