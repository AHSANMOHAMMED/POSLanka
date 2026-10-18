import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleInventory, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleInventoryListSchema, createVehicleInventorySchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle inventory for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleInventoryListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, condition, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(vehicleInventory.stockNo, `%${escaped}%`),
            ilike(vehicleInventory.vin, `%${escaped}%`),
            ilike(vehicleInventory.trim, `%${escaped}%`),
            ilike(vehicleInventory.exteriorColor, `%${escaped}%`),
            ilike(vehicleInventory.location, `%${escaped}%`)
          )
        )
      }
      if (status) {
        conditions.push(eq(vehicleInventory.status, status))
      }
      if (condition) {
        conditions.push(eq(vehicleInventory.condition, condition))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleInventory)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get vehicle inventory with make/model info
      const result = await db
        .select({
          vehicle: vehicleInventory,
          makeName: vehicleMakes.name,
          modelName: vehicleModels.name,
        })
        .from(vehicleInventory)
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .where(whereClause)
        .orderBy(desc(vehicleInventory.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      const data = result.map(r => ({
        ...r.vehicle,
        makeName: r.makeName,
        modelName: r.modelName,
      }))

      // Return paginated response (or just array for backward compatibility with all=true)
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
    logError('api/vehicle-inventory', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle inventory' }, { status: 500 })
  }
}

// POST create new vehicle inventory record
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createVehicleInventorySchema)
    if (!parsed.success) return parsed.response
    const {
      stockNo, vin, makeId, modelId, year, trim,
      condition, status: vehicleStatus, mileage, exteriorColor, interiorColor,
      transmission, fuelType, engineType, drivetrain, bodyType,
      purchasePrice, askingPrice, minimumPrice,
      warehouseId, location, description, features, photos,
      purchasedFrom, purchaseDate,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate stock number within tenant (RLS scopes the query)
      if (stockNo) {
        const existingStockNo = await db.query.vehicleInventory.findFirst({
          where: eq(vehicleInventory.stockNo, stockNo.trim()),
        })
        if (existingStockNo) {
          return NextResponse.json({ error: 'A vehicle with this stock number already exists' }, { status: 400 })
        }
      }

      // Check for duplicate VIN within tenant (RLS scopes the query)
      if (vin) {
        const existingVin = await db.query.vehicleInventory.findFirst({
          where: eq(vehicleInventory.vin, vin.trim().toUpperCase()),
        })
        if (existingVin) {
          return NextResponse.json({ error: 'A vehicle with this VIN already exists' }, { status: 400 })
        }
      }

      const [newVehicle] = await db.insert(vehicleInventory).values({
        tenantId: session!.user.tenantId,
        stockNo: stockNo ? stockNo.trim() : null,
        vin: vin ? vin.trim().toUpperCase() : null,
        makeId: makeId || null,
        modelId: modelId || null,
        year,
        trim: trim || null,
        condition,
        status: vehicleStatus,
        mileage: mileage ?? null,
        exteriorColor: exteriorColor || null,
        interiorColor: interiorColor || null,
        transmission: transmission || null,
        fuelType: fuelType || null,
        engineType: engineType || null,
        drivetrain: drivetrain || null,
        bodyType: bodyType || null,
        purchasePrice: purchasePrice != null ? String(purchasePrice) : null,
        askingPrice: askingPrice != null ? String(askingPrice) : null,
        minimumPrice: minimumPrice != null ? String(minimumPrice) : null,
        warehouseId: warehouseId || null,
        location: location || null,
        description: description || null,
        features,
        photos,
        purchasedFrom: purchasedFrom || null,
        purchaseDate: purchaseDate || null,
        isActive: true,
        createdBy: session!.user.id,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'vehicle-inventory', 'created', newVehicle.id)

      return NextResponse.json(newVehicle)
    })
  } catch (error) {
    logError('api/vehicle-inventory', error)
    return NextResponse.json({ error: 'Failed to create vehicle inventory record' }, { status: 500 })
  }
}
