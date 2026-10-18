import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleInventory, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleInventorySchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single vehicle inventory record
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Validate ID is a valid UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid vehicle ID' }, { status: 400 })
    }

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db
        .select({
          vehicle: vehicleInventory,
          makeName: vehicleMakes.name,
          modelName: vehicleModels.name,
        })
        .from(vehicleInventory)
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .where(eq(vehicleInventory.id, id))
        .limit(1)

      if (result.length === 0) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
      }

      const vehicle = {
        ...result[0].vehicle,
        makeName: result[0].makeName,
        modelName: result[0].modelName,
      }

      return NextResponse.json(vehicle)
    })
  } catch (error) {
    logError('api/vehicle-inventory/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 })
  }
}

// PUT update vehicle inventory record
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleInventorySchema)
    if (!parsed.success) return parsed.response
    const {
      stockNo, vin, makeId, modelId, year, trim,
      condition, status: vehicleStatus, mileage, exteriorColor, interiorColor,
      transmission, fuelType, engineType, drivetrain, bodyType,
      purchasePrice, askingPrice, minimumPrice,
      warehouseId, location, description, features, photos,
      purchasedFrom, purchaseDate, soldDate, soldPrice, saleId,
      isActive,
      expectedUpdatedAt,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current vehicle (RLS scopes the query)
        const [current] = await tx
          .select()
          .from(vehicleInventory)
          .where(eq(vehicleInventory.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Check for duplicate stock number (excluding current vehicle) - RLS scopes
        if (stockNo) {
          const existingStockNo = await tx.query.vehicleInventory.findFirst({
            where: and(
              eq(vehicleInventory.stockNo, stockNo.trim()),
              ne(vehicleInventory.id, id)
            ),
          })
          if (existingStockNo) {
            throw new Error('DUPLICATE_STOCK_NO')
          }
        }

        // Check for duplicate VIN (excluding current vehicle) - RLS scopes
        if (vin) {
          const existingVin = await tx.query.vehicleInventory.findFirst({
            where: and(
              eq(vehicleInventory.vin, vin.trim().toUpperCase()),
              ne(vehicleInventory.id, id)
            ),
          })
          if (existingVin) {
            throw new Error('DUPLICATE_VIN')
          }
        }

        // Build update data - only include fields that are provided
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (stockNo !== undefined) updateData.stockNo = stockNo ? stockNo.trim() : null
        if (vin !== undefined) updateData.vin = vin ? vin.trim().toUpperCase() : null
        if (makeId !== undefined) updateData.makeId = makeId || null
        if (modelId !== undefined) updateData.modelId = modelId || null
        if (year !== undefined) updateData.year = year
        if (trim !== undefined) updateData.trim = trim || null
        if (condition !== undefined) updateData.condition = condition
        if (vehicleStatus !== undefined) updateData.status = vehicleStatus
        if (mileage !== undefined) updateData.mileage = mileage ?? null
        if (exteriorColor !== undefined) updateData.exteriorColor = exteriorColor || null
        if (interiorColor !== undefined) updateData.interiorColor = interiorColor || null
        if (transmission !== undefined) updateData.transmission = transmission || null
        if (fuelType !== undefined) updateData.fuelType = fuelType || null
        if (engineType !== undefined) updateData.engineType = engineType || null
        if (drivetrain !== undefined) updateData.drivetrain = drivetrain || null
        if (bodyType !== undefined) updateData.bodyType = bodyType || null
        if (purchasePrice !== undefined) updateData.purchasePrice = purchasePrice ? String(purchasePrice) : null
        if (askingPrice !== undefined) updateData.askingPrice = askingPrice ? String(askingPrice) : null
        if (minimumPrice !== undefined) updateData.minimumPrice = minimumPrice ? String(minimumPrice) : null
        if (warehouseId !== undefined) updateData.warehouseId = warehouseId || null
        if (location !== undefined) updateData.location = location || null
        if (description !== undefined) updateData.description = description || null
        if (features !== undefined) updateData.features = features || []
        if (photos !== undefined) updateData.photos = photos || []
        if (purchasedFrom !== undefined) updateData.purchasedFrom = purchasedFrom || null
        if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate || null
        if (soldDate !== undefined) updateData.soldDate = soldDate || null
        if (soldPrice !== undefined) updateData.soldPrice = soldPrice ? String(soldPrice) : null
        if (saleId !== undefined) updateData.saleId = saleId || null
        if (isActive !== undefined) updateData.isActive = isActive

        const [updated] = await tx.update(vehicleInventory)
          .set(updateData)
          .where(eq(vehicleInventory.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'vehicle-inventory', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/vehicle-inventory/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This vehicle was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message === 'DUPLICATE_STOCK_NO') {
      return NextResponse.json({ error: 'A vehicle with this stock number already exists' }, { status: 400 })
    }
    if (message === 'DUPLICATE_VIN') {
      return NextResponse.json({ error: 'A vehicle with this VIN already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 })
  }
}

// DELETE vehicle inventory record (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Soft delete - set isActive to false
      const [updated] = await db.update(vehicleInventory)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(vehicleInventory.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'vehicle-inventory', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-inventory/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 })
  }
}
