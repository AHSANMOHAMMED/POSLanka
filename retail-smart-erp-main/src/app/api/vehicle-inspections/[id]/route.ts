import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealershipInspections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleInspectionSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single vehicle inspection
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
      const inspection = await db.query.dealershipInspections.findFirst({
        where: eq(dealershipInspections.id, id),
        with: {
          vehicleInventory: true,
          inspectedByUser: true,
        },
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      return NextResponse.json(inspection)
    })
  } catch (error) {
    logError('api/vehicle-inspections/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle inspection' }, { status: 500 })
  }
}

// PUT update vehicle inspection
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleInspectionSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.dealershipInspections.findFirst({
        where: eq(dealershipInspections.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      }

      if (body.type !== undefined) updateData.type = body.type
      if (body.inspectionDate !== undefined) updateData.inspectionDate = body.inspectionDate
      if (body.overallRating !== undefined) updateData.overallRating = body.overallRating
      if (body.checklist !== undefined) updateData.checklist = body.checklist
      if (body.photos !== undefined) updateData.photos = body.photos
      if (body.mileageAtInspection !== undefined) updateData.mileageAtInspection = body.mileageAtInspection ?? null
      if (body.notes !== undefined) updateData.notes = body.notes
      if (body.status !== undefined) updateData.status = body.status

      const [updated] = await db.update(dealershipInspections)
        .set(updateData)
        .where(eq(dealershipInspections.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'vehicle-inspection', 'updated', updated.id, {
        userId,
        entityName: `${updated.type} inspection`,
        description: `Updated ${updated.type} inspection`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/vehicle-inspections/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle inspection' }, { status: 500 })
  }
}
