import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleInspections, inspectionDamageMarks, workOrders } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createDamageMarkSchema, updateDamageMarkSchema } from '@/lib/validation/schemas/work-orders'
import { z } from 'zod'

// GET damage marks for an inspection
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

      // Verify inspection belongs to this work order
      const inspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      const damageMarks = await db.query.inspectionDamageMarks.findMany({
        where: eq(inspectionDamageMarks.inspectionId, inspectionId),
        with: {
          diagramView: true,
          photos: true,
        },
        orderBy: (marks, { asc }) => [asc(marks.createdAt)],
      })

      return NextResponse.json(damageMarks)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/damage-marks', error)
    return NextResponse.json({ error: 'Failed to fetch damage marks' }, { status: 500 })
  }
}

// POST add damage mark
export async function POST(
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

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    const parsed = await validateBody(request, createDamageMarkSchema)
    if (!parsed.success) return parsed.response
    const { diagramViewId, positionX, positionY, damageType, severity, description, isPreExisting } = parsed.data

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
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (inspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot modify completed inspection' }, { status: 400 })
      }

      const [newMark] = await db.insert(inspectionDamageMarks).values({
        tenantId: session.user.tenantId,
        inspectionId,
        diagramViewId: diagramViewId || null,
        positionX: String(positionX),
        positionY: String(positionY),
        damageType,
        severity,
        description: description || null,
        isPreExisting,
      }).returning()

      // Broadcast work order update for damage mark change
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

      return NextResponse.json(newMark)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/damage-marks', error)
    return NextResponse.json({ error: 'Failed to add damage mark' }, { status: 500 })
  }
}

// PUT update damage mark
export async function PUT(
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

    const parsed = await validateBody(request, updateDamageMarkSchema)
    if (!parsed.success) return parsed.response
    const { markId, damageType, severity, description, isPreExisting } = parsed.data

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
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (inspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot modify completed inspection' }, { status: 400 })
      }

      const updateData: Record<string, unknown> = {}
      if (damageType !== undefined) updateData.damageType = damageType
      if (severity !== undefined) updateData.severity = severity
      if (description !== undefined) updateData.description = description
      if (isPreExisting !== undefined) updateData.isPreExisting = isPreExisting

      const [updated] = await db
        .update(inspectionDamageMarks)
        .set(updateData)
        .where(and(
          eq(inspectionDamageMarks.id, markId),
          eq(inspectionDamageMarks.inspectionId, inspectionId)
        ))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Damage mark not found' }, { status: 404 })
      }

      // Broadcast work order update for damage mark change
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/damage-marks', error)
    return NextResponse.json({ error: 'Failed to update damage mark' }, { status: 500 })
  }
}

// DELETE remove damage mark
export async function DELETE(
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
    const { searchParams } = new URL(request.url)
    const markId = searchParams.get('markId')

    if (!markId) {
      return NextResponse.json({ error: 'Mark ID is required' }, { status: 400 })
    }

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
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (inspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot modify completed inspection' }, { status: 400 })
      }

      // Verify mark belongs to this inspection and delete (cascades to photos)
      const deleted = await db
        .delete(inspectionDamageMarks)
        .where(and(
          eq(inspectionDamageMarks.id, markId),
          eq(inspectionDamageMarks.inspectionId, inspectionId)
        ))
        .returning()

      if (deleted.length === 0) {
        return NextResponse.json({ error: 'Damage mark not found' }, { status: 404 })
      }

      // Broadcast work order update for damage mark deletion
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/damage-marks', error)
    return NextResponse.json({ error: 'Failed to delete damage mark' }, { status: 500 })
  }
}
