import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { db } from '@/lib/db'
import { vehicleMakes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation/helpers'
import { createVehicleMakeSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle makes
export async function GET() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await db.query.vehicleMakes.findMany({
      where: eq(vehicleMakes.isActive, true),
      orderBy: (vehicleMakes, { asc }) => [asc(vehicleMakes.name)],
    })

    return NextResponse.json(result)
  } catch (error) {
    logError('api/vehicle-makes', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle makes' }, { status: 500 })
  }
}

// POST create new vehicle make
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

    const parsed = await validateBody(request, createVehicleMakeSchema)
    if (!parsed.success) return parsed.response
    const { name, country } = parsed.data

    // Check if make already exists
    const existing = await db.query.vehicleMakes.findFirst({
      where: eq(vehicleMakes.name, name),
    })

    if (existing) {
      return NextResponse.json({ error: 'Make already exists' }, { status: 400 })
    }

    const [newMake] = await db.insert(vehicleMakes).values({
      name,
      country: country || null,
      isActive: true,
    }).returning()

    if (session.user.tenantId) {
      logAndBroadcast(session.user.tenantId, 'vehicle-make', 'created', newMake.id, { userId: session.user.id, entityName: newMake.name })
    }
    return NextResponse.json(newMake)
  } catch (error) {
    logError('api/vehicle-makes', error)
    return NextResponse.json({ error: 'Failed to create vehicle make' }, { status: 500 })
  }
}
