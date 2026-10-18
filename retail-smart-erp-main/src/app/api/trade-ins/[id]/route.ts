import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { tradeInVehicles, vehicleInventory } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateTradeInSchema } from '@/lib/validation/schemas/dealership'

// GET single trade-in
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
      const tradeIn = await db.query.tradeInVehicles.findFirst({
        where: eq(tradeInVehicles.id, id),
      })

      if (!tradeIn) {
        return NextResponse.json({ error: 'Trade-in not found' }, { status: 404 })
      }

      return NextResponse.json(tradeIn)
    })
  } catch (error) {
    logError('api/trade-ins/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch trade-in' }, { status: 500 })
  }
}

// PUT update trade-in
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
    const parsed = await validateBody(request, updateTradeInSchema)
    if (!parsed.success) return parsed.response
    const {
      saleId, make, model, year, vin, mileage,
      condition, color, appraisalValue, tradeInAllowance,
      conditionNotes, appraisedBy,
      status,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Use transaction for status changes that create inventory records
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(tradeInVehicles)
          .where(eq(tradeInVehicles.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (saleId !== undefined) updateData.saleId = saleId || null
        if (make !== undefined) updateData.make = make || null
        if (model !== undefined) updateData.model = model || null
        if (year !== undefined) updateData.year = year
        if (vin !== undefined) updateData.vin = vin ? vin.trim().toUpperCase() : null
        if (mileage !== undefined) updateData.mileage = mileage ?? null
        if (condition !== undefined) updateData.condition = condition || null
        if (color !== undefined) updateData.color = color || null
        if (appraisalValue !== undefined) updateData.appraisalValue = appraisalValue != null ? String(appraisalValue) : null
        if (tradeInAllowance !== undefined) updateData.tradeInAllowance = tradeInAllowance != null ? String(tradeInAllowance) : null
        if (conditionNotes !== undefined) updateData.conditionNotes = conditionNotes || null
        if (appraisedBy !== undefined) updateData.appraisedBy = appraisedBy

        if (status !== undefined) {
          updateData.status = status

          // When trade-in is accepted and added to inventory, create a vehicleInventory record
          if (status === 'added_to_inventory') {
            const tradeInVin = vin ? vin.trim().toUpperCase() : current.vin
            const tradeInYear = year ?? current.year
            const tradeInMileage = mileage ?? current.mileage
            const tradeInColor = color || current.color
            const tradeInCondition = condition || current.condition || 'used'

            // Use tradeInAllowance or appraisalValue as purchase price
            const purchasePrice = tradeInAllowance
              ? String(tradeInAllowance)
              : (appraisalValue ? String(appraisalValue) : (current.tradeInAllowance || current.appraisalValue || null))

            const [newInventory] = await tx.insert(vehicleInventory).values({
              tenantId: session.user.tenantId,
              vin: tradeInVin || null,
              year: tradeInYear,
              condition: tradeInCondition,
              status: 'available',
              mileage: tradeInMileage || null,
              exteriorColor: tradeInColor || null,
              purchasePrice,
              description: `Trade-in vehicle. Trade-in ID: ${id}`,
              isActive: true,
              createdBy: session.user.id,
            }).returning()

            // Store reference to the created inventory record
            updateData.addedToInventoryId = newInventory.id

            // Broadcast inventory change
            logAndBroadcast(session.user.tenantId, 'vehicle-inventory', 'created', newInventory.id)
          }
        }

        const [updated] = await tx.update(tradeInVehicles)
          .set(updateData)
          .where(eq(tradeInVehicles.id, id))
          .returning()

        return updated
      })

      // Broadcast the trade-in change to connected clients
      logAndBroadcast(session.user.tenantId, 'trade-in', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/trade-ins/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Trade-in not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Failed to update trade-in' }, { status: 500 })
  }
}

// DELETE trade-in
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
      // Check if trade-in has been added to inventory
      const tradeIn = await db.query.tradeInVehicles.findFirst({
        where: eq(tradeInVehicles.id, id),
      })

      if (!tradeIn) {
        return NextResponse.json({ error: 'Trade-in not found' }, { status: 404 })
      }

      if (tradeIn.status === 'added_to_inventory') {
        return NextResponse.json({
          error: 'Cannot delete trade-in that has been added to inventory',
        }, { status: 400 })
      }

      const [deleted] = await db.delete(tradeInVehicles)
        .where(eq(tradeInVehicles.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Trade-in not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'trade-in', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/trade-ins/[id]', error)
    return NextResponse.json({ error: 'Failed to delete trade-in' }, { status: 500 })
  }
}
