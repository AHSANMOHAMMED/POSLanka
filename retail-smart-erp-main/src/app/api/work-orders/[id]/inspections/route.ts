import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleInspections, inspectionTemplates, inspectionResponses, workOrders } from '@/lib/db/schema'
import { eq, and, or, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createInspectionSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET inspections for a work order
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
    const { id: workOrderId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify work order exists (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      const inspections = await db.query.vehicleInspections.findMany({
        where: eq(vehicleInspections.workOrderId, workOrderId),
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
        orderBy: (insp, { desc }) => [desc(insp.createdAt)],
      })

      return NextResponse.json(inspections)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections', error)
    return NextResponse.json({ error: 'Failed to fetch inspections' }, { status: 500 })
  }
}

// POST create new inspection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId } = paramsParsed.data

    const parsed = await validateBody(request, createInspectionSchema)
    if (!parsed.success) return parsed.response
    const { inspectionType, templateId, fuelLevel, odometerReading, notes } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify work order exists (RLS scopes to tenant)
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
        with: {
          vehicle: {
            with: {
              vehicleType: true,
            },
          },
        },
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      if (!workOrder.vehicleId) {
        return NextResponse.json({ error: 'Work order has no vehicle assigned' }, { status: 400 })
      }

      // Get the template (either specified or default for vehicle type)
      let selectedTemplateId = templateId
      const vehicle = Array.isArray(workOrder.vehicle) ? workOrder.vehicle[0] : workOrder.vehicle
      const vehicleType = vehicle ? (Array.isArray(vehicle.vehicleType) ? vehicle.vehicleType[0] : vehicle.vehicleType) : null

      if (!selectedTemplateId && vehicleType) {
        // Find default template for this vehicle type
        // Templates can be system defaults (null tenantId) or tenant's own
        const defaultTemplate = await db.query.inspectionTemplates.findFirst({
          where: and(
            eq(inspectionTemplates.vehicleTypeId, vehicleType.id),
            eq(inspectionTemplates.inspectionType, inspectionType || 'check_in'),
            eq(inspectionTemplates.isDefault, true),
            eq(inspectionTemplates.isActive, true),
            or(
              isNull(inspectionTemplates.tenantId),
              eq(inspectionTemplates.tenantId, session.user.tenantId)
            )
          ),
        })

        if (defaultTemplate) {
          selectedTemplateId = defaultTemplate.id
        }
      }

      // Check if inspection of this type already exists
      const existingInspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.workOrderId, workOrderId),
          eq(vehicleInspections.inspectionType, inspectionType || 'check_in')
        ),
      })

      if (existingInspection) {
        return NextResponse.json(
          { error: `A ${inspectionType || 'check_in'} inspection already exists for this work order` },
          { status: 400 }
        )
      }

      // Create the inspection
      const [newInspection] = await db.insert(vehicleInspections).values({
        tenantId: session.user.tenantId,
        workOrderId,
        vehicleId: workOrder.vehicleId,
        templateId: selectedTemplateId || null,
        inspectionType: inspectionType || 'check_in',
        status: 'draft',
        fuelLevel: fuelLevel ?? null,
        odometerReading: odometerReading ?? workOrder.odometerIn ?? null,
        inspectedBy: session.user.id,
        startedAt: new Date(),
        notes: notes || null,
      }).returning()

      // If we have a template, pre-populate responses with null values (batch insert)
      if (selectedTemplateId) {
        const template = await db.query.inspectionTemplates.findFirst({
          where: eq(inspectionTemplates.id, selectedTemplateId),
          with: {
            categories: {
              with: {
                items: true,
              },
            },
          },
        })

        if (template) {
          const categories = Array.isArray(template.categories) ? template.categories : []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const responsesToCreate = categories.flatMap((category: any) => {
            const items = Array.isArray(category.items) ? category.items : []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return items.map((item: any) => ({
              tenantId: session.user.tenantId,
              inspectionId: newInspection.id,
              checklistItemId: item.id,
              response: null,
              value: null,
              notes: null,
            }))
          })

          if (responsesToCreate.length > 0) {
            await db.insert(inspectionResponses).values(responsesToCreate)
          }
        }
      }

      // Fetch and return the complete inspection
      const createdInspection = await db.query.vehicleInspections.findFirst({
        where: eq(vehicleInspections.id, newInspection.id),
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

      return NextResponse.json(createdInspection)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections', error)
    return NextResponse.json({ error: 'Failed to create inspection' }, { status: 500 })
  }
}
