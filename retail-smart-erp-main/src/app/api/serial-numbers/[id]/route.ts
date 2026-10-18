import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import {
  itemSerialNumbers,
  serialNumberMovements,
  items,
  warehouses,
  users,
} from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { createSerialMovement } from '@/lib/inventory/serial-numbers'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSerialNumberSchema } from '@/lib/validation/schemas/items'
import { idParamSchema } from '@/lib/validation/schemas/common'

type SerialNumberStatus = 'available' | 'reserved' | 'sold' | 'returned' | 'defective' | 'scrapped' | 'lost'

// GET - Get serial number detail with recent movements
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

    return await withTenant(session.user.tenantId, async (db) => {
      // Get serial number with item and warehouse info
      const [serialNumber] = await db
        .select({
          id: itemSerialNumbers.id,
          itemId: itemSerialNumbers.itemId,
          itemName: items.name,
          serialNumber: itemSerialNumbers.serialNumber,
          status: itemSerialNumbers.status,
          warehouseId: itemSerialNumbers.warehouseId,
          warehouseName: warehouses.name,
          warrantyStartDate: itemSerialNumbers.warrantyStartDate,
          warrantyEndDate: itemSerialNumbers.warrantyEndDate,
          warrantyNotes: itemSerialNumbers.warrantyNotes,
          notes: itemSerialNumbers.notes,
          createdBy: itemSerialNumbers.createdBy,
          createdAt: itemSerialNumbers.createdAt,
          updatedAt: itemSerialNumbers.updatedAt,
        })
        .from(itemSerialNumbers)
        .leftJoin(items, eq(itemSerialNumbers.itemId, items.id))
        .leftJoin(warehouses, eq(itemSerialNumbers.warehouseId, warehouses.id))
        .where(eq(itemSerialNumbers.id, id))

      if (!serialNumber) {
        return NextResponse.json(
          { error: 'Serial number not found' },
          { status: 404 }
        )
      }

      // Get last 10 movements with changed_by user name
      const recentMovements = await db
        .select({
          id: serialNumberMovements.id,
          fromStatus: serialNumberMovements.fromStatus,
          toStatus: serialNumberMovements.toStatus,
          fromWarehouseId: serialNumberMovements.fromWarehouseId,
          toWarehouseId: serialNumberMovements.toWarehouseId,
          referenceType: serialNumberMovements.referenceType,
          referenceId: serialNumberMovements.referenceId,
          changedBy: serialNumberMovements.changedBy,
          changedByName: users.fullName,
          notes: serialNumberMovements.notes,
          createdAt: serialNumberMovements.createdAt,
        })
        .from(serialNumberMovements)
        .leftJoin(users, eq(serialNumberMovements.changedBy, users.id))
        .where(eq(serialNumberMovements.serialNumberId, id))
        .orderBy(desc(serialNumberMovements.createdAt))
        .limit(10)

      return NextResponse.json({
        ...serialNumber,
        recentMovements,
      })
    })
  } catch (error) {
    logError('api/serial-numbers/[id]', error)
    return NextResponse.json(
      { error: 'Failed to fetch serial number' },
      { status: 500 }
    )
  }
}

// PUT - Update serial number
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

    const parsed = await validateBody(request, updateSerialNumberSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const tenantId = session!.user.tenantId
    const userId = session!.user.id

    return await withTenant(tenantId, async (db) => {
      return await db.transaction(async (tx) => {
        // Lock and get current serial number
        const [current] = await tx
          .select()
          .from(itemSerialNumbers)
          .where(eq(itemSerialNumbers.id, id))
          .for('update')

        if (!current) {
          return NextResponse.json(
            { error: 'Serial number not found' },
            { status: 404 }
          )
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (body.warrantyStartDate !== undefined) {
          updateData.warrantyStartDate = body.warrantyStartDate || null
        }
        if (body.warrantyEndDate !== undefined) {
          updateData.warrantyEndDate = body.warrantyEndDate || null
        }
        if (body.warrantyNotes !== undefined) {
          updateData.warrantyNotes = body.warrantyNotes || null
        }
        if (body.notes !== undefined) {
          updateData.notes = body.notes || null
        }

        const statusChanged = body.status && body.status !== current.status
        const warehouseChanged =
          body.warehouseId !== undefined &&
          body.warehouseId !== current.warehouseId

        if (body.status) {
          updateData.status = body.status
        }
        if (body.warehouseId !== undefined) {
          updateData.warehouseId = body.warehouseId || null
        }

        // Update the serial number record
        const [updated] = await tx
          .update(itemSerialNumbers)
          .set(updateData)
          .where(eq(itemSerialNumbers.id, id))
          .returning()

        // Create movement record if status or warehouse changed
        if (statusChanged || warehouseChanged) {
          await createSerialMovement(tx, {
            tenantId,
            serialNumberId: id,
            fromStatus: current.status as SerialNumberStatus,
            toStatus: (body.status || current.status) as SerialNumberStatus,
            fromWarehouseId: current.warehouseId,
            toWarehouseId:
              body.warehouseId !== undefined
                ? body.warehouseId
                : current.warehouseId,
            referenceType: 'manual_adjustment',
            referenceId: null,
            changedBy: userId,
            notes: body.notes !== undefined ? body.notes : null,
          })
        }

        logAndBroadcast(tenantId, 'serial-number', 'updated', id)
        return NextResponse.json(updated)
      })
    })
  } catch (error) {
    logError('api/serial-numbers/[id]', error)
    return NextResponse.json(
      { error: 'Failed to update serial number' },
      { status: 500 }
    )
  }
}
