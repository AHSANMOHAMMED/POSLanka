import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleInspections, inspectionPhotos, workOrders } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { deleteInspectionPhotoFiles } from '@/lib/utils/file-cleanup'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateInspectionSchema } from '@/lib/validation/schemas/work-orders'
import { z } from 'zod'

// GET single inspection
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify work order exists (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      const inspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
        with: {
          vehicle: {
            with: {
              vehicleType: {
                with: {
                  diagramViews: true,
                },
              },
            },
          },
          template: {
            with: {
              categories: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderBy: (cats: any, { asc }: any) => [asc(cats.sortOrder)],
                with: {
                  items: {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    orderBy: (items: any, { asc }: any) => [asc(items.sortOrder)],
                  },
                },
              },
            },
          },
          inspectedByUser: true,
          responses: true,
          damageMarks: true,
          photos: true,
        },
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      // Flatten the response to include diagramViews at the top level for easier frontend access
      const vehicle = Array.isArray(inspection.vehicle) ? inspection.vehicle[0] : inspection.vehicle
      const vehicleType = vehicle ? (Array.isArray(vehicle.vehicleType) ? vehicle.vehicleType[0] : vehicle.vehicleType) : null
      const diagramViews = vehicleType?.diagramViews || []
      const response = {
        ...inspection,
        diagramViews: Array.isArray(diagramViews) ? diagramViews : [],
      }

      return NextResponse.json(response)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]', error)
    return NextResponse.json({ error: 'Failed to fetch inspection' }, { status: 500 })
  }
}

// PUT update inspection (complete or update details)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    const parsed = await validateBody(request, updateInspectionSchema)
    if (!parsed.success) return parsed.response
    const { status, fuelLevel, odometerReading, customerSignature, notes } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify work order exists (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      // Check if work order can be modified (not invoiced or cancelled)
      if (workOrder.status === 'invoiced') {
        return NextResponse.json({ error: 'Cannot modify inspections for invoiced work orders' }, { status: 400 })
      }
      if (workOrder.status === 'cancelled') {
        return NextResponse.json({ error: 'Cannot modify inspections for cancelled work orders' }, { status: 400 })
      }

      // Verify inspection belongs to work order
      const existingInspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!existingInspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (fuelLevel !== undefined) updateData.fuelLevel = fuelLevel
      if (odometerReading !== undefined) updateData.odometerReading = odometerReading
      if (customerSignature !== undefined) updateData.customerSignature = customerSignature
      if (notes !== undefined) updateData.notes = notes

      // Handle status change to completed
      if (status === 'completed' && existingInspection.status !== 'completed') {
        updateData.status = 'completed'
        updateData.completedAt = new Date()
      }

      await db
        .update(vehicleInspections)
        .set(updateData)
        .where(eq(vehicleInspections.id, inspectionId))
        .returning()

      // Fetch and return the complete inspection
      const updatedInspection = await db.query.vehicleInspections.findFirst({
        where: eq(vehicleInspections.id, inspectionId),
        with: {
          vehicle: {
            with: {
              vehicleType: true,
            },
          },
          template: {
            with: {
              categories: {
                with: {
                  items: true,
                },
              },
            },
          },
          inspectedByUser: true,
          responses: true,
          damageMarks: true,
          photos: true,
        },
      })

      // Broadcast work order update for inspection change
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

      return NextResponse.json(updatedInspection)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]', error)
    return NextResponse.json({ error: 'Failed to update inspection' }, { status: 500 })
  }
}

// DELETE inspection (only draft inspections)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError2 = requirePermission(session, 'manageWorkOrders')
    if (permError2) return permError2

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify work order exists (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      // Check if work order can be modified (not invoiced or cancelled)
      if (workOrder.status === 'invoiced') {
        return NextResponse.json({ error: 'Cannot delete inspections for invoiced work orders' }, { status: 400 })
      }
      if (workOrder.status === 'cancelled') {
        return NextResponse.json({ error: 'Cannot delete inspections for cancelled work orders' }, { status: 400 })
      }

      // Verify inspection is in draft status
      const existingInspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!existingInspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (existingInspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot delete completed inspections' }, { status: 400 })
      }

      // Fetch photos before deletion (for file cleanup)
      const photosToDelete = await db.query.inspectionPhotos.findMany({
        where: eq(inspectionPhotos.inspectionId, inspectionId),
        columns: { photoUrl: true },
      })

      // Delete will cascade to responses, damage marks, and photos
      await db.delete(vehicleInspections).where(eq(vehicleInspections.id, inspectionId))

      // Clean up photo files after successful DB deletion
      // Note: Files may not exist in ephemeral storage environments (e.g., after redeploy)
      if (photosToDelete.length > 0) {
        await deleteInspectionPhotoFiles(inspectionId, photosToDelete)
      }

      // Broadcast work order update for inspection deletion
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]', error)
    return NextResponse.json({ error: 'Failed to delete inspection' }, { status: 500 })
  }
}
