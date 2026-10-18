import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db } from '@/lib/db'
import { vehicleMakes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleMakeSchema } from '@/lib/validation/schemas/vehicles'
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

    const make = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.id, id),
    })

    if (!make) {
      return NextResponse.json({ error: 'Vehicle make not found' }, { status: 404 })
    }

    return NextResponse.json(make)
  } catch (error) {
    logError('api/vehicle-makes/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle make' }, { status: 500 })
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
    const parsed = await validateBody(request, updateVehicleMakeSchema)
    if (!parsed.success) return parsed.response
    const { name, country, isActive } = parsed.data

    const existing = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.id, id),
    })

    if (!existing) {
      return NextResponse.json({ error: 'Vehicle make not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (country !== undefined) updateData.country = country
    if (isActive !== undefined) updateData.isActive = isActive

    const [updated] = await db.update(vehicleMakes)
      .set(updateData)
      .where(eq(vehicleMakes.id, id))
      .returning()

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-make', 'updated', updated.id, { userId: session.user.id, entityName: updated.name })
    }
    return NextResponse.json(updated)
  } catch (error) {
    logError('api/vehicle-makes/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle make' }, { status: 500 })
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
    const [updated] = await db.update(vehicleMakes)
      .set({ isActive: false })
      .where(eq(vehicleMakes.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Vehicle make not found' }, { status: 404 })
    }

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-make', 'deleted', id, { userId: session.user.id })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/vehicle-makes/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle make' }, { status: 500 })
  }
}
