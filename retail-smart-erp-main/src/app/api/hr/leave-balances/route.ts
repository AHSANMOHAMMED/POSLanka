import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { employeeProfiles } from '@/lib/db/schema'
import { hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { leaveBalances } from '@/lib/attendance/leave'

// GET /api/hr/leave-balances?year=&employeeProfileId= — entitlement / taken / pending / remaining
export async function GET(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const year = Number(request.nextUrl.searchParams.get('year')) || new Date().getFullYear()
  const employeeProfileId = request.nextUrl.searchParams.get('employeeProfileId')
  if (year < 2000 || year > 2100) return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  try {
    return await withTenant(auth.session.user.tenantId, async (db) => {
      const { ids } = await scopedEmployeeIds(auth.session, db)
      const rows = await db.select({ id: employeeProfiles.id }).from(employeeProfiles)
        .where(employeeProfileId && /^[0-9a-f-]{36}$/i.test(employeeProfileId) ? eq(employeeProfiles.id, employeeProfileId) : inArray(employeeProfiles.employmentStatus, ['active', 'on_leave']))
      const empIds = rows.map((r) => r.id).filter((id) => !ids || ids.has(id))
      return NextResponse.json(await leaveBalances(db, year, empIds))
    })
  } catch (error) {
    return hrError('api/hr/leave-balances', error, 'Failed to load leave balances')
  }
}
