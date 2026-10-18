import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { dealershipInspections, vehicleInventory } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleInspectionsListSchema, createVehicleInspectionSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle inspections for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleInspectionsListSchema)
    if (!parsed.success) return parsed.response
    const { vehicleInventoryId, type, status, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (vehicleInventoryId) {
        conditions.push(eq(dealershipInspections.vehicleInventoryId, vehicleInventoryId))
      }
      if (type) {
        conditions.push(eq(dealershipInspections.type, type))
      }
      if (status) {
        conditions.push(eq(dealershipInspections.status, status))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(dealershipInspections.notes, `%${escaped}%`),
            ilike(dealershipInspections.overallRating, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealershipInspections)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.dealershipInspections.findMany({
        where: whereClause,
        with: {
          vehicleInventory: true,
          inspectedByUser: true,
        },
        orderBy: [desc(dealershipInspections.createdAt)],
        limit,
        offset,
      })

      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/vehicle-inspections', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle inspections' }, { status: 500 })
  }
}

// POST create a new vehicle inspection
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createVehicleInspectionSchema)
    if (!parsed.success) return parsed.response
    const {
      vehicleInventoryId: vehInvId,
      type,
      inspectionDate,
      overallRating,
      checklist,
      photos,
      mileageAtInspection,
      notes,
      status,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate vehicleInventoryId if provided
      if (vehInvId) {
        const vehicle = await db.query.vehicleInventory.findFirst({
          where: eq(vehicleInventory.id, vehInvId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Vehicle inventory not found' }, { status: 404 })
        }
      }

      const [inspection] = await db.insert(dealershipInspections).values({
        tenantId: session.user.tenantId,
        vehicleInventoryId: vehInvId || null,
        type,
        inspectedBy: userId,
        inspectionDate: inspectionDate || null,
        overallRating: overallRating || null,
        checklist,
        photos,
        mileageAtInspection: mileageAtInspection ?? null,
        notes: notes || null,
        status,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'vehicle-inspection', 'created', inspection.id, {
        userId,
        entityName: `${type} inspection`,
        description: `Created ${type} inspection`,
      })

      return NextResponse.json(inspection)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/vehicle-inspections', error)
    return NextResponse.json({ error: 'Failed to create vehicle inspection' }, { status: 500 })
  }
}
