import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { serviceTypes } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateServiceTypeSchema } from '@/lib/validation/schemas/service-types'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single service type
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
      const serviceType = await db.query.serviceTypes.findFirst({
        where: eq(serviceTypes.id, id),
        with: {
          group: true,
        },
      })

      if (!serviceType) {
        return NextResponse.json({ error: 'Service type not found' }, { status: 404 })
      }

      return NextResponse.json(serviceType)
    })
  } catch (error) {
    logError('api/service-types/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch service type' }, { status: 500 })
  }
}

// PUT update service type
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateServiceTypeSchema)
    if (!parsed.success) return parsed.response
    const { name, description, defaultHours, defaultRate, isActive, groupId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate service type name (excluding current service type) - RLS scopes
      const existingServiceType = await db.query.serviceTypes.findFirst({
        where: and(
          eq(serviceTypes.name, name.trim()),
          ne(serviceTypes.id, id)
        ),
      })
      if (existingServiceType) {
        return NextResponse.json({ error: 'A service type with this name already exists' }, { status: 400 })
      }

      const [updated] = await db.update(serviceTypes)
        .set({
          name,
          description: description || null,
          defaultHours: defaultHours ? String(defaultHours) : null,
          defaultRate: defaultRate ? String(defaultRate) : null,
          groupId: groupId !== undefined ? (groupId || null) : undefined,
          isActive: isActive !== undefined ? isActive : true,
        })
        .where(eq(serviceTypes.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Service type not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'service', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/service-types/[id]', error)
    return NextResponse.json({ error: 'Failed to update service type' }, { status: 500 })
  }
}

// DELETE service type
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db.delete(serviceTypes)
        .where(eq(serviceTypes.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Service type not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'service', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/service-types/[id]', error)
    return NextResponse.json({ error: 'Failed to delete service type' }, { status: 500 })
  }
}
