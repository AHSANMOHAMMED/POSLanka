import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db } from '@/lib/db'
import { vehicleModels } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleModelsListSchema, createVehicleModelSchema } from '@/lib/validation/schemas/vehicles'

// GET vehicle models (optionally filtered by makeId)
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleModelsListSchema)
    if (!parsed.success) return parsed.response
    const { makeId } = parsed.data

    let result
    if (makeId) {
      result = await db.query.vehicleModels.findMany({
        where: and(
          eq(vehicleModels.makeId, makeId),
          eq(vehicleModels.isActive, true)
        ),
        orderBy: (vehicleModels, { asc }) => [asc(vehicleModels.name)],
      })
    } else {
      result = await db.query.vehicleModels.findMany({
        where: eq(vehicleModels.isActive, true),
        with: {
          make: true,
        },
        orderBy: (vehicleModels, { asc }) => [asc(vehicleModels.name)],
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    logError('api/vehicle-models', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle models' }, { status: 500 })
  }
}

// POST create new vehicle model
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError
    if (session.user.tenantId) {
      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return quotaError
    }

    const parsed = await validateBody(request, createVehicleModelSchema)
    if (!parsed.success) return parsed.response
    const { name, makeId } = parsed.data

    // Check if model already exists for this make
    const existing = await db.query.vehicleModels.findFirst({
      where: and(
        eq(vehicleModels.name, name),
        eq(vehicleModels.makeId, makeId)
      ),
    })

    if (existing) {
      return NextResponse.json({ error: 'Model already exists for this make' }, { status: 400 })
    }

    const [newModel] = await db.insert(vehicleModels).values({
      name,
      makeId,
      isActive: true,
    }).returning()

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-model', 'created', newModel.id, { userId: session.user.id, entityName: newModel.name })
    }
    return NextResponse.json(newModel)
  } catch (error) {
    logError('api/vehicle-models', error)
    return NextResponse.json({ error: 'Failed to create vehicle model' }, { status: 500 })
  }
}
