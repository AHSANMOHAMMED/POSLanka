import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicles, customers, vehicleTypes, workOrders, vehicleOwnershipHistory } from '@/lib/db/schema'
import { eq, and, or, isNull, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single vehicle
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
      const vehicle = await db.query.vehicles.findFirst({
        where: eq(vehicles.id, id),
        with: {
          customer: true,
          vehicleType: true,
        },
      })

      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
      }

      return NextResponse.json(vehicle)
    })
  } catch (error) {
    logError('api/vehicles/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 })
  }
}

// PUT update vehicle
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleSchema)
    if (!parsed.success) return parsed.response
    const { customerId, vehicleTypeId, make, model, year, vin, licensePlate, color, currentMileage, notes, expectedUpdatedAt } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
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
              eq(vehicleTypes.tenantId, session!.user.tenantId)
            )
          ),
        })
        if (!vehicleType) {
          return NextResponse.json({ error: 'Invalid vehicle type' }, { status: 400 })
        }
      }

      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current vehicle (RLS scopes the query)
        const [currentVehicle] = await tx
          .select()
          .from(vehicles)
          .where(eq(vehicles.id, id))
          .for('update')

        if (!currentVehicle) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentVehicle.updatedAt ? new Date(currentVehicle.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Check for duplicate license plate (excluding current vehicle) - RLS scopes
        if (licensePlate) {
          const existingPlate = await tx.query.vehicles.findFirst({
            where: and(
              eq(vehicles.licensePlate, licensePlate.trim().toUpperCase()),
              ne(vehicles.id, id)
            ),
          })
          if (existingPlate) {
            throw new Error('DUPLICATE_LICENSE_PLATE')
          }
        }

        // Check for duplicate VIN (excluding current vehicle) - RLS scopes
        if (vin) {
          const existingVin = await tx.query.vehicles.findFirst({
            where: and(
              eq(vehicles.vin, vin.trim().toUpperCase()),
              ne(vehicles.id, id)
            ),
          })
          if (existingVin) {
            throw new Error('DUPLICATE_VIN')
          }
        }

        // Track ownership change if customerId changed
        const newCustomerId = customerId || null
        const previousCustomerId = currentVehicle.customerId || null
        if (newCustomerId !== previousCustomerId) {
          await tx.insert(vehicleOwnershipHistory).values({
            tenantId: session!.user.tenantId,
            vehicleId: id,
            customerId: newCustomerId,
            previousCustomerId: previousCustomerId,
            changedBy: session!.user.id,
          })
        }

        const [updated] = await tx.update(vehicles)
          .set({
            customerId: customerId || null,
            vehicleTypeId: vehicleTypeId || null,
            make,
            model,
            year: year ?? null,
            vin: vin ? vin.trim().toUpperCase() : null,
            licensePlate: licensePlate ? licensePlate.trim().toUpperCase() : null,
            color: color || null,
            currentMileage: currentMileage ?? null,
            notes: notes || null,
            updatedAt: new Date(),
          })
          .where(eq(vehicles.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'vehicle', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/vehicles/[id]', error)
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
    if (message === 'DUPLICATE_LICENSE_PLATE') {
      return NextResponse.json({ error: 'A vehicle with this license plate already exists' }, { status: 400 })
    }
    if (message === 'DUPLICATE_VIN') {
      return NextResponse.json({ error: 'A vehicle with this VIN already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 })
  }
}

// DELETE vehicle
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check if vehicle is used in any work orders (RLS scopes the query)
      const workOrderUsingVehicle = await db.query.workOrders.findFirst({
        where: eq(workOrders.vehicleId, id),
      })

      if (workOrderUsingVehicle) {
        return NextResponse.json(
          { error: 'Cannot delete vehicle that is linked to work orders' },
          { status: 400 }
        )
      }

      const [deleted] = await db.delete(vehicles)
        .where(eq(vehicles.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'vehicle', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicles/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 })
  }
}
