import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { vehicleInspections, inspectionResponses, workOrders } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { upsertInspectionResponseSchema } from '@/lib/validation/schemas/work-orders'
import { z } from 'zod'

// GET responses for an inspection
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

      const responses = await db.query.inspectionResponses.findMany({
        where: eq(inspectionResponses.inspectionId, inspectionId),
        with: {
          checklistItem: true,
          photos: true,
        },
      })

      return NextResponse.json(responses)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/responses', error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }
}

// POST/PUT update responses (upsert)
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

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    const parsed = await validateBody(request, upsertInspectionResponseSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Execute with RLS tenant context + transaction for atomicity of bulk updates
    return await withTenantTransaction(session.user.tenantId, async (db) => {
      // Verify access and that inspection is not completed (RLS scopes to tenant)
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

      // Handle single response update
      if ('checklistItemId' in body && !('responses' in body)) {
        const { checklistItemId, response, value, notes } = body

        // Check if response already exists
        const existingResponse = await db.query.inspectionResponses.findFirst({
          where: and(
            eq(inspectionResponses.inspectionId, inspectionId),
            eq(inspectionResponses.checklistItemId, checklistItemId)
          ),
        })

        if (existingResponse) {
          // Update existing
          const [updated] = await db
            .update(inspectionResponses)
            .set({
              response: response ?? existingResponse.response,
              value: value !== undefined ? value : existingResponse.value,
              notes: notes !== undefined ? notes : existingResponse.notes,
            })
            .where(eq(inspectionResponses.id, existingResponse.id))
            .returning()

          // Broadcast work order update for inspection response change
          logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

          return NextResponse.json(updated)
        } else {
          // Create new
          const [created] = await db.insert(inspectionResponses).values({
            tenantId: session.user.tenantId,
            inspectionId,
            checklistItemId,
            response: response || null,
            value: value || null,
            notes: notes || null,
          }).returning()

          // Broadcast work order update for inspection response change
          logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

          return NextResponse.json(created)
        }
      }

      // Handle bulk update
      if ('responses' in body && Array.isArray(body.responses)) {
        for (const resp of body.responses) {
          const existingResponse = await db.query.inspectionResponses.findFirst({
            where: and(
              eq(inspectionResponses.inspectionId, inspectionId),
              eq(inspectionResponses.checklistItemId, resp.checklistItemId)
            ),
          })

          if (existingResponse) {
            await db
              .update(inspectionResponses)
              .set({
                response: resp.response ?? existingResponse.response,
                value: resp.value !== undefined ? resp.value : existingResponse.value,
                notes: resp.notes !== undefined ? resp.notes : existingResponse.notes,
              })
              .where(eq(inspectionResponses.id, existingResponse.id))
          } else {
            await db.insert(inspectionResponses).values({
              tenantId: session.user.tenantId,
              inspectionId,
              checklistItemId: resp.checklistItemId,
              response: resp.response || null,
              value: resp.value || null,
              notes: resp.notes || null,
            })
          }
        }

        // Broadcast work order update for bulk inspection response change
        logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)

        return NextResponse.json({ success: true })
      }

      // This should not be reachable since Zod validates the union type
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/responses', error)
    return NextResponse.json({ error: 'Failed to update responses' }, { status: 500 })
  }
}
