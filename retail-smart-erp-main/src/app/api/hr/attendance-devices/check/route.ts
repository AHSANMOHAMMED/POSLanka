import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { cleanSerial } from '@/lib/attendance/iclock'

// GET /api/hr/attendance-devices/check?serial= — has a device with this exact serial contacted the
// server (before registration)? Exact match only, so no other business's serials are listed.
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const serial = cleanSerial(request.nextUrl.searchParams.get('serial'))
  if (!serial) return NextResponse.json({ error: 'Invalid serial number' }, { status: 400 })
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const res = await db.execute(sql`SELECT last_seen_at, hits FROM attendance_pending_devices WHERE upper(serial_number) = ${serial.toUpperCase()} LIMIT 1`)
      const row = res.rows?.[0] as { last_seen_at: string; hits: number } | undefined
      return NextResponse.json({ seen: !!row, lastSeenAt: row?.last_seen_at ?? null, hits: row ? Number(row.hits) : 0 })
    })
  } catch (error) {
    return hrError('api/hr/attendance-devices/check', error, 'Failed to check device')
  }
}
