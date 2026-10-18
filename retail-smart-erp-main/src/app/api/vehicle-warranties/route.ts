import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleWarranties, vehicleInventory, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleWarrantiesListSchema, createVehicleWarrantySchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle warranties for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleWarrantiesListSchema)
    if (!parsed.success) return parsed.response
    const { status, vehicleInventoryId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (status) {
        conditions.push(eq(vehicleWarranties.status, status))
      }
      if (vehicleInventoryId) {
        conditions.push(eq(vehicleWarranties.vehicleInventoryId, vehicleInventoryId))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleWarranties)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get warranties with vehicle info
      const result = await db
        .select({
          warranty: vehicleWarranties,
          vehicleMakeName: vehicleMakes.name,
          vehicleModelName: vehicleModels.name,
          vehicleYear: vehicleInventory.year,
          vehicleVin: vehicleInventory.vin,
          vehicleStockNo: vehicleInventory.stockNo,
        })
        .from(vehicleWarranties)
        .leftJoin(vehicleInventory, eq(vehicleWarranties.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .where(whereClause)
        .orderBy(desc(vehicleWarranties.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      const data = result.map(r => ({
        ...r.warranty,
        vehicleMake: r.vehicleMakeName,
        vehicleModel: r.vehicleModelName,
        vehicleYear: r.vehicleYear,
        vehicleVin: r.vehicleVin,
        vehicleStockNo: r.vehicleStockNo,
      }))

      // Return paginated response
      if (all) {
        return NextResponse.json(data)
      }

      return NextResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/vehicle-warranties', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle warranties' }, { status: 500 })
  }
}

// POST create new vehicle warranty
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleWarrantySchema)
    if (!parsed.success) return parsed.response
    const {
      saleId, vehicleInventoryId,
      warrantyType, provider, policyNumber,
      startDate, endDate, mileageLimit,
      coverageDetails, price,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate vehicle exists
      const vehicle = await db.query.vehicleInventory.findFirst({
        where: eq(vehicleInventory.id, vehicleInventoryId),
      })
      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 400 })
      }

      // Determine status based on dates
      const now = new Date()
      const start = startDate ? new Date(startDate) : now
      const end = endDate ? new Date(endDate) : null
      let warrantyStatus = 'active'
      if (now < start) {
        warrantyStatus = 'active' // Will become active on start date
      }
      if (end && now > end) {
        warrantyStatus = 'expired'
      }

      const [newWarranty] = await db.insert(vehicleWarranties).values({
        tenantId: session.user.tenantId,
        saleId,
        vehicleInventoryId,
        warrantyType,
        provider: provider || null,
        policyNumber: policyNumber || null,
        startDate: startDate || null,
        endDate: endDate || null,
        mileageLimit: mileageLimit ?? null,
        coverageDetails: coverageDetails || null,
        price: price != null ? String(price) : null,
        status: warrantyStatus,
        isActive: true,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'vehicle-warranty', 'created', newWarranty.id)

      return NextResponse.json(newWarranty)
    })
  } catch (error) {
    logError('api/vehicle-warranties', error)
    return NextResponse.json({ error: 'Failed to create vehicle warranty' }, { status: 500 })
  }
}
