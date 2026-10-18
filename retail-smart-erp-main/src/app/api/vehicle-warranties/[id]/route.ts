import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleWarranties, vehicleInventory, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleWarrantySchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single vehicle warranty
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
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
        .where(eq(vehicleWarranties.id, id))
        .limit(1)

      if (result.length === 0) {
        return NextResponse.json({ error: 'Warranty not found' }, { status: 404 })
      }

      const data = {
        ...result[0].warranty,
        vehicleMake: result[0].vehicleMakeName,
        vehicleModel: result[0].vehicleModelName,
        vehicleYear: result[0].vehicleYear,
        vehicleVin: result[0].vehicleVin,
        vehicleStockNo: result[0].vehicleStockNo,
      }

      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/vehicle-warranties/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch warranty' }, { status: 500 })
  }
}

// PUT update vehicle warranty
export async function PUT(
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
    const parsed = await validateBody(request, updateVehicleWarrantySchema)
    if (!parsed.success) return parsed.response
    const {
      warrantyType, provider, policyNumber,
      startDate, endDate, mileageLimit,
      coverageDetails, price,
      status, isActive,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(vehicleWarranties)
          .where(eq(vehicleWarranties.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (warrantyType !== undefined) updateData.warrantyType = warrantyType
        if (provider !== undefined) updateData.provider = provider || null
        if (policyNumber !== undefined) updateData.policyNumber = policyNumber || null
        if (startDate !== undefined) updateData.startDate = startDate || null
        if (endDate !== undefined) updateData.endDate = endDate || null
        if (mileageLimit !== undefined) updateData.mileageLimit = mileageLimit ?? null
        if (coverageDetails !== undefined) updateData.coverageDetails = coverageDetails || null
        if (price !== undefined) updateData.price = price != null ? String(price) : null
        if (status !== undefined) updateData.status = status
        if (isActive !== undefined) updateData.isActive = isActive

        const [updated] = await tx.update(vehicleWarranties)
          .set(updateData)
          .where(eq(vehicleWarranties.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'vehicle-warranty', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/vehicle-warranties/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Warranty not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Failed to update warranty' }, { status: 500 })
  }
}

// DELETE vehicle warranty
export async function DELETE(
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [deleted] = await db.delete(vehicleWarranties)
        .where(eq(vehicleWarranties.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Warranty not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'vehicle-warranty', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-warranties/[id]', error)
    return NextResponse.json({ error: 'Failed to delete warranty' }, { status: 500 })
  }
}
