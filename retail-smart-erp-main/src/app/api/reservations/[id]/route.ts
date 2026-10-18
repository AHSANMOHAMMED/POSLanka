import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { reservations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateReservationSchema, deleteReservationSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// Valid status transitions
const validStatusTransitions: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed', 'cancelled'],
  completed: [], // Terminal state
  cancelled: [], // Terminal state
  no_show: [], // Terminal state
}

// GET single reservation
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
      const reservation = await db.query.reservations.findFirst({
        where: eq(reservations.id, id),
        with: {
          table: true,
          customer: true,
          restaurantOrder: true,
        },
      })

      if (!reservation) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
      }

      return NextResponse.json(reservation)
    })
  } catch (error) {
    logError('api/reservations/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch reservation' }, { status: 500 })
  }
}

// PUT update reservation
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateReservationSchema)
    if (!parsed.success) return parsed.response
    const {
      customerName,
      customerPhone,
      customerEmail,
      tableId,
      reservationDate,
      reservationTime,
      partySize,
      estimatedDuration,
      status,
      notes,
      specialRequests,
      source,
      cancellationReason,
      expectedUpdatedAt,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock and get current reservation
        const [current] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking check
        if (expectedUpdatedAt) {
          const clientTime = new Date(expectedUpdatedAt).getTime()
          const serverTime = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverTime > clientTime) {
            throw new Error('CONFLICT')
          }
        }

        // Build update data
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        // Handle field updates
        if (customerName !== undefined) updateData.customerName = customerName || null
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone || null
        if (customerEmail !== undefined) updateData.customerEmail = customerEmail || null
        if (tableId !== undefined) updateData.tableId = tableId || null
        if (reservationDate !== undefined) updateData.reservationDate = reservationDate
        if (reservationTime !== undefined) updateData.reservationTime = reservationTime
        if (partySize !== undefined) updateData.partySize = partySize
        if (estimatedDuration !== undefined) updateData.estimatedDuration = estimatedDuration
        if (notes !== undefined) updateData.notes = notes || null
        if (specialRequests !== undefined) updateData.specialRequests = specialRequests || null
        if (source !== undefined) updateData.source = source

        // Handle status change
        if (status && status !== current.status) {
          const allowedTransitions = validStatusTransitions[current.status] || []
          if (!allowedTransitions.includes(status)) {
            throw new Error(
              `INVALID_TRANSITION:Cannot change status from '${current.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`
            )
          }

          updateData.status = status

          // When cancelling, require a reason
          if (status === 'cancelled') {
            if (!cancellationReason) {
              throw new Error('CANCELLATION_REASON_REQUIRED')
            }
            updateData.cancellationReason = cancellationReason
            updateData.cancelledAt = new Date()
          }
        }

        // Update the reservation
        const [updated] = await tx.update(reservations)
          .set(updateData)
          .where(eq(reservations.id, id))
          .returning()

        return updated
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'reservation', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reservations/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This reservation was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message.startsWith('INVALID_TRANSITION:')) {
      return NextResponse.json({ error: message.replace('INVALID_TRANSITION:', '') }, { status: 400 })
    }
    if (message === 'CANCELLATION_REASON_REQUIRED') {
      return NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
}

// DELETE (cancel) reservation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Get cancellation reason from body (optional)
    const parsed = await validateBody(request, deleteReservationSchema)
    const cancellationReason = parsed.success ? (parsed.data?.cancellationReason || null) : null

    return await withTenant(session.user.tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock and get current reservation
        const [current] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Can only cancel non-terminal reservations
        const terminalStatuses = ['completed', 'cancelled', 'no_show']
        if (terminalStatuses.includes(current.status)) {
          throw new Error('CANNOT_CANCEL_TERMINAL')
        }

        // Cancel the reservation
        const [updated] = await tx.update(reservations)
          .set({
            status: 'cancelled',
            cancellationReason: cancellationReason || 'Cancelled by staff',
            cancelledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, id))
          .returning()

        return updated
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'reservation', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/reservations/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }
    if (message === 'CANNOT_CANCEL_TERMINAL') {
      return NextResponse.json({ error: 'Cannot cancel a reservation that is already completed, cancelled, or marked as no-show' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to cancel reservation' }, { status: 500 })
  }
}
