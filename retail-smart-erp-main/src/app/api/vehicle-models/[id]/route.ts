import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db } from '@/lib/db'
import { vehicleModels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleModelSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const model = await db.query.vehicleModels.findFirst({
      where: eq(vehicleModels.id, id),
      with: { make: true },
    })

    if (!model) {
      return NextResponse.json({ error: 'Vehicle model not found' }, { status: 404 })
    }

    return NextResponse.json(model)
  } catch (error) {
    logError('api/vehicle-models/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle model' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleModelSchema)
    if (!parsed.success) return parsed.response
    const { name, makeId, isActive } = parsed.data

    const existing = await db.query.vehicleModels.findFirst({
      where: eq(vehicleModels.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Vehicle model not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (makeId !== undefined) updateData.makeId = makeId
    if (isActive !== undefined) updateData.isActive = isActive

    const [updated] = await db.update(vehicleModels)
      .set(updateData)
      .where(eq(vehicleModels.id, id))
      .returning()

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-model', 'updated', updated.id, { userId: session.user.id, entityName: updated.name })
    }
    return NextResponse.json(updated)
  } catch (error) {
    logError('api/vehicle-models/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle model' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Soft delete by setting isActive to false
    const [updated] = await db.update(vehicleModels)
      .set({ isActive: false })
      .where(eq(vehicleModels.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Vehicle model not found' }, { status: 404 })
    }

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-model', 'deleted', id, { userId: session.user.id })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/vehicle-models/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle model' }, { status: 500 })
  }
}
