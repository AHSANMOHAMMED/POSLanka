import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicles, customers, vehicleTypes } from '@/lib/db/schema'
import { eq, and, or, isNull, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { vehiclesListSchema, createVehicleSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicles for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehiclesListSchema)
    if (!parsed.success) return parsed.response
    const { customerId, search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (customerId) {
        conditions.push(eq(vehicles.customerId, customerId))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(vehicles.make, `%${escaped}%`),
            ilike(vehicles.model, `%${escaped}%`),
            ilike(vehicles.licensePlate, `%${escaped}%`),
            ilike(vehicles.vin, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicles)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.vehicles.findMany({
        where: whereClause,
        with: {
          customer: true,
          vehicleType: true,
        },
        orderBy: (vehicles, { desc }) => [desc(vehicles.createdAt)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/vehicles', error)
    return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 })
  }
}

// POST create new vehicle
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleSchema)
    if (!parsed.success) return parsed.response
    const { customerId, vehicleTypeId, make, model, year, vin, licensePlate, color, currentMileage, notes } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate customerId belongs to tenant (RLS scopes the query)
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        }
      }

      // Validate vehicleTypeId if provided (allow system defaults or tenant's own)
      if (vehicleTypeId) {
        const vehicleType = await db.query.vehicleTypes.findFirst({
          where: and(
            eq(vehicleTypes.id, vehicleTypeId),
            or(
              isNull(vehicleTypes.tenantId),
              eq(vehicleTypes.tenantId, session.user.tenantId)
            )
          ),
        })
        if (!vehicleType) {
          return NextResponse.json({ error: 'Invalid vehicle type' }, { status: 400 })
        }
      }

      // Check for duplicate license plate within tenant (RLS scopes the query)
      if (licensePlate) {
        const existingPlate = await db.query.vehicles.findFirst({
          where: eq(vehicles.licensePlate, licensePlate.trim().toUpperCase()),
        })
        if (existingPlate) {
          return NextResponse.json({ error: 'A vehicle with this license plate already exists' }, { status: 400 })
        }
      }

      // Check for duplicate VIN within tenant (RLS scopes the query)
      if (vin) {
        const existingVin = await db.query.vehicles.findFirst({
          where: eq(vehicles.vin, vin.trim().toUpperCase()),
        })
        if (existingVin) {
          return NextResponse.json({ error: 'A vehicle with this VIN already exists' }, { status: 400 })
        }
      }

      const [newVehicle] = await db.insert(vehicles).values({
        tenantId: session.user.tenantId,
        customerId: customerId || null,
        vehicleTypeId: vehicleTypeId || null,
        make,
        model,
        year: year != null ? Number(year) : null,
        vin: vin ? vin.trim().toUpperCase() : null,
        licensePlate: licensePlate ? licensePlate.trim().toUpperCase() : null,
        color: color || null,
        currentMileage: currentMileage != null ? Number(currentMileage) : null,
        notes: notes || null,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'vehicle', 'created', newVehicle.id)

      return NextResponse.json(newVehicle)
    })
  } catch (error) {
    logError('api/vehicles', error)
    return NextResponse.json({ error: 'Failed to create vehicle' }, { status: 500 })
  }
}
