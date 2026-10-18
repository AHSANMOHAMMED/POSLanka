import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealerAllocations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateDealerAllocationSchema } from '@/lib/validation/schemas/dealership'

// GET single dealer allocation
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
      const allocation = await db.query.dealerAllocations.findFirst({
        where: eq(dealerAllocations.id, id),
        with: {
          dealer: true,
          vehicleInventory: true,
          allocatedByUser: true,
          returnedByUser: true,
          stockTransfer: true,
        },
      })

      if (!allocation) {
        return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })
      }

      return NextResponse.json(allocation)
    })
  } catch (error) {
    logError('api/dealer-allocations/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch dealer allocation' }, { status: 500 })
  }
}

// PUT update dealer allocation (status to returned/sold)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageDealers')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateDealerAllocationSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.dealerAllocations.findFirst({
        where: eq(dealerAllocations.id, id),
        with: {
          dealer: true,
          vehicleInventory: true,
        },
      })

      if (!existing) {
        return NextResponse.json({ error: 'Allocation not found' }, { status: 404 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      }

      if (body.status !== undefined) {
        // Validate status transition
        const validTransitions: Record<string, string[]> = {
          allocated: ['returned', 'sold'],
          returned: [],
          sold: [],
        }
        const currentStatus = existing.status || 'allocated'
        const allowedNext = validTransitions[currentStatus] || []
        if (!allowedNext.includes(body.status)) {
          return NextResponse.json({
            error: `Cannot change status from '${currentStatus}' to '${body.status}'`,
          }, { status: 400 })
        }

        updateData.status = body.status

        if (body.status === 'returned') {
          updateData.returnedAt = new Date()
          updateData.returnedBy = userId
          if (body.returnReason) {
            updateData.returnReason = body.returnReason
          }
        }
      }

      if (body.askingPrice !== undefined) updateData.askingPrice = body.askingPrice != null ? String(body.askingPrice) : null
      if (body.minimumPrice !== undefined) updateData.minimumPrice = body.minimumPrice != null ? String(body.minimumPrice) : null
      if (body.notes !== undefined) updateData.notes = body.notes

      const [updated] = await db.update(dealerAllocations)
        .set(updateData)
        .where(eq(dealerAllocations.id, id))
        .returning()

      const dealerName = existing.dealer?.name || 'Dealer'
      const vehicleRef = existing.vehicleInventory?.stockNo || existing.vehicleInventory?.vin || 'Vehicle'

      logAndBroadcast(session.user.tenantId, 'dealer-allocation', 'updated', updated.id, {
        userId,
        entityName: `${dealerName} - ${vehicleRef}`,
        description: body.status
          ? `Updated allocation status to ${body.status} for ${dealerName}`
          : `Updated allocation for ${dealerName}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/dealer-allocations/[id]', error)
    return NextResponse.json({ error: 'Failed to update dealer allocation' }, { status: 500 })
  }
}
