import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { testDrives, vehicleInventory, vehicleMakes, vehicleModels, customers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateTestDriveSchema } from '@/lib/validation/schemas/dealership'

// GET single test drive
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
          testDrive: testDrives,
          vehicleMakeName: vehicleMakes.name,
          vehicleModelName: vehicleModels.name,
          vehicleYear: vehicleInventory.year,
          vehicleStockNo: vehicleInventory.stockNo,
          vehicleVin: vehicleInventory.vin,
          customerName: customers.name,
          customerPhone: customers.phone,
          customerEmail: customers.email,
        })
        .from(testDrives)
        .leftJoin(vehicleInventory, eq(testDrives.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .leftJoin(customers, eq(testDrives.customerId, customers.id))
        .where(eq(testDrives.id, id))
        .limit(1)

      if (result.length === 0) {
        return NextResponse.json({ error: 'Test drive not found' }, { status: 404 })
      }

      const data = {
        ...result[0].testDrive,
        vehicleMake: result[0].vehicleMakeName,
        vehicleModel: result[0].vehicleModelName,
        vehicleYear: result[0].vehicleYear,
        vehicleStockNo: result[0].vehicleStockNo,
        vehicleVin: result[0].vehicleVin,
        customerName: result[0].customerName || result[0].testDrive.customerName,
        customerPhone: result[0].customerPhone || result[0].testDrive.customerPhone,
        customerEmail: result[0].customerEmail || result[0].testDrive.customerEmail,
      }

      return NextResponse.json(data)
    })
  } catch (error) {
    logError('api/test-drives/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch test drive' }, { status: 500 })
  }
}

// PUT update test drive
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
    const parsed = await validateBody(request, updateTestDriveSchema)
    if (!parsed.success) return parsed.response
    const {
      vehicleInventoryId, customerId, salespersonId,
      scheduledDate, scheduledTime, durationMinutes,
      customerName, customerPhone, customerEmail,
      status, notes, feedback, cancellationReason,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(testDrives)
          .where(eq(testDrives.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (vehicleInventoryId !== undefined) updateData.vehicleInventoryId = vehicleInventoryId
        if (customerId !== undefined) updateData.customerId = customerId || null
        if (salespersonId !== undefined) updateData.salespersonId = salespersonId
        if (scheduledDate !== undefined) updateData.scheduledDate = scheduledDate
        if (scheduledTime !== undefined) updateData.scheduledTime = scheduledTime
        if (durationMinutes !== undefined) updateData.durationMinutes = durationMinutes ?? null
        if (customerName !== undefined) updateData.customerName = customerName || null
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone || null
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail || null
        if (notes !== undefined) updateData.notes = notes || null
        if (feedback !== undefined) updateData.feedback = feedback || null

        if (status !== undefined) {
          updateData.status = status
          if (status === 'cancelled') {
            updateData.cancellationReason = cancellationReason || null
            updateData.cancelledAt = new Date()
          }
        }

        const [updated] = await tx.update(testDrives)
          .set(updateData)
          .where(eq(testDrives.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'test-drive', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/test-drives/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Test drive not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Failed to update test drive' }, { status: 500 })
  }
}

// DELETE test drive
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
      const [deleted] = await db.delete(testDrives)
        .where(eq(testDrives.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Test drive not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'test-drive', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/test-drives/[id]', error)
    return NextResponse.json({ error: 'Failed to delete test drive' }, { status: 500 })
  }
}
