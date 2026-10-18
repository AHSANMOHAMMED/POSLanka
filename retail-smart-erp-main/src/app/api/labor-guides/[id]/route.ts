import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { laborGuides } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateLaborGuideSchema } from '@/lib/validation/schemas/service-types'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single labor guide
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
      const guide = await db.query.laborGuides.findFirst({
        where: eq(laborGuides.id, id),
        with: { serviceType: true, make: true, model: true },
      })

      if (!guide) {
        return NextResponse.json({ error: 'Labor guide not found' }, { status: 404 })
      }

      return NextResponse.json(guide)
    })
  } catch (error) {
    logError('api/labor-guides/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch labor guide' }, { status: 500 })
  }
}

// PUT update labor guide
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
    const parsed = await validateBody(request, updateLaborGuideSchema)
    if (!parsed.success) return parsed.response
    const { serviceTypeId, makeId, modelId, yearFrom, yearTo, hours } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      // Build update data
      const updateData: Record<string, unknown> = {
        hours: String(hours),
        makeId: makeId || null,
        modelId: modelId || null,
        yearFrom: yearFrom ?? null,
        yearTo: yearTo ?? null,
      }

      // Only update serviceTypeId if provided
      if (serviceTypeId) {
        updateData.serviceTypeId = serviceTypeId
      }

      const [updated] = await db.update(laborGuides)
        .set(updateData)
        .where(eq(laborGuides.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Labor guide not found' }, { status: 404 })
      }

      // Fetch the full guide with relations
      const fullGuide = await db.query.laborGuides.findFirst({
        where: eq(laborGuides.id, updated.id),
        with: { serviceType: true, make: true, model: true },
      })

      logAndBroadcast(session!.user.tenantId, 'labor-guide', 'updated', id)
      return NextResponse.json(fullGuide)
    })
  } catch (error) {
    logError('api/labor-guides/[id]', error)
    return NextResponse.json({ error: 'Failed to update labor guide' }, { status: 500 })
  }
}

// DELETE labor guide
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

    return await withTenant(session!.user.tenantId, async (db) => {
      const [deleted] = await db.delete(laborGuides)
        .where(eq(laborGuides.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Labor guide not found' }, { status: 404 })
      }

      logAndBroadcast(session!.user.tenantId, 'labor-guide', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/labor-guides/[id]', error)
    return NextResponse.json({ error: 'Failed to delete labor guide' }, { status: 500 })
  }
}
