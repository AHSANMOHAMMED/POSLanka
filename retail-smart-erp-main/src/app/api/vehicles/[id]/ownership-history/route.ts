import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleOwnershipHistory } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET ownership history for a vehicle
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
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const history = await db.query.vehicleOwnershipHistory.findMany({
        where: eq(vehicleOwnershipHistory.vehicleId, id),
        with: {
          customer: true,
          previousCustomer: true,
          changedByUser: true,
        },
        orderBy: desc(vehicleOwnershipHistory.changedAt),
      })

      return NextResponse.json(history)
    })
  } catch (error) {
    logError('api/vehicles/[id]/ownership-history', error)
    return NextResponse.json({ error: 'Failed to fetch ownership history' }, { status: 500 })
  }
}
