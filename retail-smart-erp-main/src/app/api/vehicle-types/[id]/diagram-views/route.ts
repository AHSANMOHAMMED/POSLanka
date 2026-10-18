import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleTypes, vehicleTypeDiagramViews } from '@/lib/db/schema'
import { eq, and, or, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { createDiagramViewSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET diagram views for a vehicle type
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
      // Verify access to this vehicle type - allow system defaults (null tenantId) or tenant's own
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          or(
            isNull(vehicleTypes.tenantId),
            eq(vehicleTypes.tenantId, session.user.tenantId)
          )
        ),
      })

      if (!vehicleType) {
        return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 })
      }

      const views = await db.query.vehicleTypeDiagramViews.findMany({
        where: eq(vehicleTypeDiagramViews.vehicleTypeId, id),
        orderBy: (views, { asc }) => [asc(views.sortOrder)],
      })

      return NextResponse.json(views)
    })
  } catch (error) {
    logError('api/vehicle-types/[id]/diagram-views', error)
    return NextResponse.json({ error: 'Failed to fetch diagram views' }, { status: 500 })
  }
}

// POST create new diagram view (only for tenant's own vehicle types)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, createDiagramViewSchema)
    if (!parsed.success) return parsed.response
    const { viewName, imageUrl, imageWidth, imageHeight, sortOrder } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify ownership - can only add to tenant's own vehicle types
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          eq(vehicleTypes.tenantId, session.user.tenantId)
        ),
      })

      if (!vehicleType) {
        return NextResponse.json(
          { error: 'Vehicle type not found or cannot be modified' },
          { status: 404 }
        )
      }

      // Get current max sortOrder
      const existingViews = await db.query.vehicleTypeDiagramViews.findMany({
        where: eq(vehicleTypeDiagramViews.vehicleTypeId, id),
      })
      const maxSortOrder = Math.max(...existingViews.map(v => v.sortOrder), -1)

      const [newView] = await db.insert(vehicleTypeDiagramViews).values({
        tenantId: session.user.tenantId,
        vehicleTypeId: id,
        viewName,
        imageUrl: imageUrl || null,
        imageWidth: imageWidth ?? null,
        imageHeight: imageHeight ?? null,
        sortOrder: sortOrder ?? maxSortOrder + 1,
      }).returning()

      // Broadcast vehicle type update for diagram view change
      logAndBroadcast(session.user.tenantId, 'vehicle-type', 'updated', id)

      return NextResponse.json(newView)
    })
  } catch (error) {
    logError('api/vehicle-types/[id]/diagram-views', error)
    return NextResponse.json({ error: 'Failed to create diagram view' }, { status: 500 })
  }
}
