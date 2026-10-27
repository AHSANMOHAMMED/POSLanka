import { NextRequest, NextResponse } from 'next/server'
import { asc } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { leaveTypes } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { leaveTypeSchema } from '@/lib/validation/schemas/attendance'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

/** Common Sri Lankan leave types (Shop & Office Employees Act: 14 annual, 7 casual; sick by policy) */
const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual Leave', code: 'AL', daysPerYear: '14', isPaid: true },
  { name: 'Casual Leave', code: 'CL', daysPerYear: '7', isPaid: true },
  { name: 'Sick Leave', code: 'SL', daysPerYear: '7', isPaid: true },
  { name: 'No-pay Leave', code: 'NP', daysPerYear: '0', isPaid: false },
]

// GET /api/hr/leave-types (first call seeds the common types)
export async function GET() {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      let rows = await db.select().from(leaveTypes).orderBy(asc(leaveTypes.name))
      if (rows.length === 0) {
        await db.insert(leaveTypes).values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, tenantId }))).onConflictDoNothing()
        rows = await db.select().from(leaveTypes).orderBy(asc(leaveTypes.name))
      }
      return NextResponse.json(rows)
    })
  } catch (error) {
    return hrError('api/hr/leave-types', error, 'Failed to load leave types')
  }
}

// POST /api/hr/leave-types
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, leaveTypeSchema)
  if (!parsed.success) return parsed.response
  const d = parsed.data
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const [row] = await db.insert(leaveTypes).values({
        tenantId, name: d.name, code: d.code || null, daysPerYear: String(d.daysPerYear), isPaid: d.isPaid, isActive: d.isActive,
      }).returning()
      logAndBroadcast(tenantId, 'leave-request', 'created', row.id, { userId: auth.session.user.id, entityName: `Leave type ${row.name}` })
      return NextResponse.json(row, { status: 201 })
    })
  } catch (error) {
    return hrError('api/hr/leave-types', error, 'Failed to create leave type')
  }
}
