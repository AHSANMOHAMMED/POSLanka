import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { workOrders, vehicles } from '@/lib/db/schema'
import { eq, and, desc, ne } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// W25: GET service history for a vehicle
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
    const { searchParams } = new URL(request.url)
    const excludeWorkOrderId = searchParams.get('excludeWorkOrderId')

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify vehicle exists (RLS scopes to tenant)
      const vehicle = await db.query.vehicles.findFirst({
        where: eq(vehicles.id, vehicleId),
      })

      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
      }

      // Get all work orders for this vehicle with their services and parts (RLS scopes)
      const result = await db.query.workOrders.findMany({
        where: and(
          eq(workOrders.vehicleId, vehicleId),
          // Optionally exclude current work order
          excludeWorkOrderId ? ne(workOrders.id, excludeWorkOrderId) : undefined
        ),
      with: {
        services: {
          with: {
            serviceType: true,
          },
        },
        parts: {
          with: {
            item: true,
          },
        },
      },
      orderBy: [desc(workOrders.createdAt)],
      limit: 10, // Limit to last 10 work orders
    })

      // Format the response
      const history = result.map(wo => ({
        id: wo.id,
        orderNo: wo.orderNo,
        status: wo.status,
        odometerIn: wo.odometerIn,
        createdAt: wo.createdAt,
        completedAt: wo.status === 'invoiced' ? wo.updatedAt : null,
        total: wo.total,
        services: wo.services.map(s => ({
          id: s.id,
          name: s.serviceType?.name || s.description || 'Labor',
          hours: s.hours,
          amount: s.amount,
        })),
        partsCount: wo.parts.length,
      }))

      return NextResponse.json(history)
    })
  } catch (error) {
    logError('api/vehicles/[id]/service-history', error)
    return NextResponse.json({ error: 'Failed to fetch service history' }, { status: 500 })
  }
}
