import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { costCenters, glEntries } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCostCenterSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

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
      const costCenter = await db.query.costCenters.findFirst({
        where: eq(costCenters.id, id),
        with: { children: true },
      })

      if (!costCenter) {
        return NextResponse.json({ error: 'Cost center not found' }, { status: 404 })
      }

      return NextResponse.json(costCenter)
    })
  } catch (error) {
    logError('api/accounting/cost-centers/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch cost center' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCostCenterSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const existing = await db.query.costCenters.findFirst({
        where: eq(costCenters.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Cost center not found' }, { status: 404 })
      }

      // Build update data - only include provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (body.name !== undefined) updateData.name = body.name
      if (body.parentId !== undefined) updateData.parentId = body.parentId || null
      if (body.isGroup !== undefined) updateData.isGroup = body.isGroup
      if (body.isActive !== undefined) updateData.isActive = body.isActive

      // If changing parentId, validate the parent
      if (body.parentId) {
        // Prevent setting self as parent
        if (body.parentId === id) {
          return NextResponse.json(
            { error: 'A cost center cannot be its own parent' },
            { status: 400 }
          )
        }

        const parent = await db
          .select({ id: costCenters.id, isGroup: costCenters.isGroup })
          .from(costCenters)
          .where(eq(costCenters.id, body.parentId))
          .limit(1)

        if (parent.length === 0) {
          return NextResponse.json(
            { error: 'Parent cost center not found' },
            { status: 404 }
          )
        }

        if (!parent[0].isGroup) {
          return NextResponse.json(
            { error: 'Parent cost center must be a group' },
            { status: 400 }
          )
        }
      }

      // If changing isGroup from true to false, check for children
      if (body.isGroup === false && existing.isGroup) {
        const [{ childCount }] = await db
          .select({ childCount: sql<number>`count(*)::int` })
          .from(costCenters)
          .where(eq(costCenters.parentId, id))

        if (Number(childCount) > 0) {
          return NextResponse.json(
            { error: 'Cannot unset group flag on a cost center with children' },
            { status: 400 }
          )
        }
      }

      const [updated] = await db.update(costCenters)
        .set(updateData)
        .where(eq(costCenters.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Cost center not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'cost-center', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/cost-centers/[id]', error)
    return NextResponse.json({ error: 'Failed to update cost center' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const costCenter = await db.query.costCenters.findFirst({
        where: eq(costCenters.id, id),
      })

      if (!costCenter) {
        return NextResponse.json({ error: 'Cost center not found' }, { status: 404 })
      }

      // Check if cost center has children
      const [{ childCount }] = await db
        .select({ childCount: sql<number>`count(*)::int` })
        .from(costCenters)
        .where(eq(costCenters.parentId, id))

      if (Number(childCount) > 0) {
        return NextResponse.json(
          { error: 'Cannot delete cost center with child cost centers' },
          { status: 400 }
        )
      }

      // Check if cost center is referenced in GL entries
      const [{ glCount }] = await db
        .select({ glCount: sql<number>`count(*)::int` })
        .from(glEntries)
        .where(eq(glEntries.costCenterId, id))

      if (Number(glCount) > 0) {
        return NextResponse.json(
          { error: 'Cannot delete cost center with existing GL entries' },
          { status: 400 }
        )
      }

      const [deleted] = await db.delete(costCenters)
        .where(eq(costCenters.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Cost center not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'cost-center', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/cost-centers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete cost center' }, { status: 500 })
  }
}
