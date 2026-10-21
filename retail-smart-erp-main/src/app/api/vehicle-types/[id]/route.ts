import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleTypes } from '@/lib/db/schema'
import { eq, and, or, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleTypeSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { otherFieldsSet, setDefaultHidden } from '@/lib/defaults/hidden-defaults'

// GET single vehicle type
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
    // Note: RLS allows null tenantId for system defaults, and tenant's own records
    return await withTenant(session.user.tenantId, async (db) => {
      // Allow fetching system defaults or tenant-specific types
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          or(
            isNull(vehicleTypes.tenantId),
            eq(vehicleTypes.tenantId, session.user.tenantId)
          )
        ),
        with: {
          diagramViews: {
            orderBy: (views, { asc }) => [asc(views.sortOrder)],
          },
          inspectionTemplates: {
            where: eq(vehicleTypes.isActive, true),
          },
        },
      })

      if (!vehicleType) {
        return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 })
      }

      return NextResponse.json(vehicleType)
    })
  } catch (error) {
    logError('api/vehicle-types/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle type' }, { status: 500 })
  }
}

// PUT update vehicle type
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleTypeSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check if vehicle type exists and is tenant's own (not system default)
      const existingType = await db.query.vehicleTypes.findFirst({
        where: eq(vehicleTypes.id, id),
      })

      if (!existingType) {
        return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 })
      }

      // System defaults are shared by every company (tenant_id IS NULL) and are read-only
      // for tenants (RLS). {isActive} alone hides / re-shows the row for THIS company only
      // (tenant_hidden_defaults override); anything else is refused.
      if (existingType.isSystemDefault || !existingType.tenantId) {
        if (!existingType.tenantId && typeof body.isActive === 'boolean' && otherFieldsSet(body).length === 0) {
          const hidden = !body.isActive
          await setDefaultHidden(db, session!.user.tenantId, 'vehicle_type', id, hidden, session!.user.id)
          logAndBroadcast(session!.user.tenantId, 'vehicle-type', 'updated', id, {
            userId: session!.user.id,
            entityName: existingType.name,
            description: hidden ? 'Hid system vehicle type for this company' : 'Restored system vehicle type for this company',
          })
          return NextResponse.json({ ...existingType, hidden })
        }
        return NextResponse.json({ error: 'Cannot modify system default vehicle types' }, { status: 403 })
      }

      // Verify ownership (RLS should handle this, but double-check for system defaults)
      if (existingType.tenantId !== session!.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      const { name, bodyType, description, wheelCount, isActive } = body

      const [updated] = await db
        .update(vehicleTypes)
        .set({
          name: name ?? existingType.name,
          bodyType: (bodyType ?? existingType.bodyType) as typeof vehicleTypes.bodyType.enumValues[number],
          description: description !== undefined ? description : existingType.description,
          wheelCount: wheelCount ?? existingType.wheelCount,
          isActive: isActive ?? existingType.isActive,
          updatedAt: new Date(),
        })
        .where(eq(vehicleTypes.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'vehicle-type', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/vehicle-types/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle type' }, { status: 500 })
  }
}

// PATCH — same as PUT; on a system default only {isActive} is accepted (per-company hide/show)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(request, context)
}

// DELETE vehicle type (only tenant's own, not system defaults)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const existingType = await db.query.vehicleTypes.findFirst({
        where: eq(vehicleTypes.id, id),
      })

      if (!existingType) {
        return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 })
      }

      if (existingType.isSystemDefault) {
        return NextResponse.json({ error: 'Cannot delete system default vehicle types' }, { status: 403 })
      }

      if (existingType.tenantId !== session!.user.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      // Soft delete by deactivating
      const [updated] = await db
        .update(vehicleTypes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(vehicleTypes.id, id))
        .returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'vehicle-type', 'deleted', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/vehicle-types/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle type' }, { status: 500 })
  }
}
