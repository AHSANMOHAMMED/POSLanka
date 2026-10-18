import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { dealerAllocations, dealers, vehicleInventory } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { dealerAllocationsListSchema, createDealerAllocationSchema } from '@/lib/validation/schemas/dealership'

// GET all dealer allocations for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, dealerAllocationsListSchema)
    if (!parsed.success) return parsed.response
    const { dealerId, vehicleInventoryId, status, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (dealerId) {
        conditions.push(eq(dealerAllocations.dealerId, dealerId))
      }
      if (vehicleInventoryId) {
        conditions.push(eq(dealerAllocations.vehicleInventoryId, vehicleInventoryId))
      }
      if (status) {
        conditions.push(eq(dealerAllocations.status, status))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(dealerAllocations.notes, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealerAllocations)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.dealerAllocations.findMany({
        where: whereClause,
        with: {
          dealer: true,
          vehicleInventory: true,
          allocatedByUser: true,
          returnedByUser: true,
          stockTransfer: true,
        },
        orderBy: [desc(dealerAllocations.createdAt)],
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
    logError('api/dealer-allocations', error)
    return NextResponse.json({ error: 'Failed to fetch dealer allocations' }, { status: 500 })
  }
}

// POST create a new dealer allocation
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createDealerAllocationSchema)
    if (!parsed.success) return parsed.response
    const { dealerId, vehicleInventoryId: vehInvId, askingPrice, minimumPrice, notes } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate dealer exists
      const dealer = await db.query.dealers.findFirst({
        where: eq(dealers.id, dealerId),
      })
      if (!dealer) {
        return NextResponse.json({ error: 'Dealer not found' }, { status: 404 })
      }

      // Validate vehicle inventory exists
      const vehicle = await db.query.vehicleInventory.findFirst({
        where: eq(vehicleInventory.id, vehInvId),
      })
      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle inventory not found' }, { status: 404 })
      }

      // Check for existing active allocation on this vehicle
      const existingAllocation = await db.query.dealerAllocations.findFirst({
        where: and(
          eq(dealerAllocations.vehicleInventoryId, vehInvId),
          eq(dealerAllocations.status, 'allocated')
        ),
      })
      if (existingAllocation) {
        return NextResponse.json({ error: 'This vehicle already has an active allocation' }, { status: 400 })
      }

      const [allocation] = await db.insert(dealerAllocations).values({
        tenantId: session.user.tenantId,
        dealerId,
        vehicleInventoryId: vehInvId,
        allocatedBy: userId,
        status: 'allocated',
        askingPrice: askingPrice != null ? String(askingPrice) : null,
        minimumPrice: minimumPrice != null ? String(minimumPrice) : null,
        notes: notes || null,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'dealer-allocation', 'created', allocation.id, {
        userId,
        entityName: `${dealer.name} - ${vehicle.stockNo || vehicle.vin || 'Vehicle'}`,
        description: `Allocated vehicle to dealer ${dealer.name}`,
      })

      return NextResponse.json(allocation)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/dealer-allocations', error)
    return NextResponse.json({ error: 'Failed to create dealer allocation' }, { status: 500 })
  }
}
