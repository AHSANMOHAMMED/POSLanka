import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { appointments } from '@/lib/db/schema'
import { eq, and, isNull, notInArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET pending appointments for a vehicle (not yet converted to work order)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: vehicleId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Get appointments that are not cancelled, not completed, and not yet linked to a work order
      // RLS scopes to tenant automatically
      const pendingAppointments = await db.query.appointments.findMany({
        where: and(
          eq(appointments.vehicleId, vehicleId),
          isNull(appointments.workOrderId),
          notInArray(appointments.status, ['cancelled', 'no_show', 'completed'])
        ),
        with: {
          customer: true,
          serviceType: true,
        },
        orderBy: (appointments, { asc }) => [asc(appointments.scheduledDate), asc(appointments.scheduledTime)],
      })

      return NextResponse.json(pendingAppointments)
    })
  } catch (error) {
    logError('api/vehicles/[id]/appointments', error)
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
  }
}
