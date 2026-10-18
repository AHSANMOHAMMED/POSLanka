import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { serviceTypeGroups } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateServiceTypeGroupSchema } from '@/lib/validation/schemas/service-types'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single service type group
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
      const group = await db.query.serviceTypeGroups.findFirst({
        where: eq(serviceTypeGroups.id, id),
        with: {
          serviceTypes: true,
        },
      })

      if (!group) {
        return NextResponse.json({ error: 'Service type group not found' }, { status: 404 })
      }

      return NextResponse.json(group)
    })
  } catch (error) {
    logError('api/service-type-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch service type group' }, { status: 500 })
  }
}

// PUT update service type group
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateServiceTypeGroupSchema)
    if (!parsed.success) return parsed.response
    const { name, description, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [updated] = await db.update(serviceTypeGroups)
        .set({
          name: name || undefined,
          description: description !== undefined ? (description || null) : undefined,
          isActive: isActive !== undefined ? isActive : undefined,
        })
        .where(eq(serviceTypeGroups.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Service type group not found' }, { status: 404 })
      }

      // Broadcast service type group update
      logAndBroadcast(session.user.tenantId, 'service-type-group', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/service-type-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to update service type group' }, { status: 500 })
  }
}

// DELETE service type group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [deleted] = await db.delete(serviceTypeGroups)
        .where(eq(serviceTypeGroups.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Service type group not found' }, { status: 404 })
      }

      // Broadcast service type group deletion
      logAndBroadcast(session.user.tenantId, 'service-type-group', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/service-type-groups/[id]', error)
    return NextResponse.json({ error: 'Failed to delete service type group' }, { status: 500 })
  }
}
