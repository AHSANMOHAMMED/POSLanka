import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { reservations, restaurantTables } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateReservationSchema, deleteReservationSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { findTableReservationConflict } from '@/lib/restaurant/reservation-conflicts'
import { assertRecordBranch, getBranchScope, canAccessBranch } from '@/lib/auth/branch-access'

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
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'restaurant')
    if (moduleError) return moduleError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // K4: a booking of another branch is refused
      const branchDenied = await assertRecordBranch(session, db, reservations, id)
      if (branchDenied) return branchDenied

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
      // K4: a booking of another branch is refused
      const branchDenied = await assertRecordBranch(session, db, reservations, id)
      if (branchDenied) return branchDenied

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

        // Re-check the table when the booking moves (table, date, time, duration) or comes back
        const nextTableId = tableId !== undefined ? (tableId || null) : current.tableId
        const nextStatus = status || current.status
        const slotChanged = tableId !== undefined || reservationDate !== undefined
          || reservationTime !== undefined || estimatedDuration !== undefined
        if (nextTableId && slotChanged && ['pending', 'confirmed', 'seated'].includes(nextStatus)) {
          const [table] = await tx.select({ id: restaurantTables.id, warehouseId: restaurantTables.warehouseId })
            .from(restaurantTables).where(eq(restaurantTables.id, nextTableId)).for('update')
          if (!table) throw new Error('TABLE_NOT_FOUND')
          // K4: a booking stays in its branch — only that branch's tables (and ones the user may use)
          if (current.warehouseId && table.warehouseId && table.warehouseId !== current.warehouseId) throw new Error('OTHER_BRANCH_TABLE')
          if (!canAccessBranch(await getBranchScope(session, tx), table.warehouseId)) throw new Error('BRANCH_DENIED')
          const conflict = await findTableReservationConflict(tx, {
            tableId: nextTableId,
            reservationDate: reservationDate ?? String(current.reservationDate),
            reservationTime: reservationTime ?? String(current.reservationTime),
            estimatedDuration: estimatedDuration ?? current.estimatedDuration ?? 60,
            excludeId: id,
          })
          if (conflict) throw new Error(`DOUBLE_BOOKED:This table is already reserved at ${conflict.reservationTime.slice(0, 5)}. Choose another table or time.`)
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
        if (!current.warehouseId && nextTableId) {
          // an older booking without a branch takes its table's
          const [t] = await tx.select({ warehouseId: restaurantTables.warehouseId }).from(restaurantTables).where(eq(restaurantTables.id, nextTableId))
          if (t?.warehouseId) updateData.warehouseId = t.warehouseId
        }
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
    if (message === 'TABLE_NOT_FOUND') {
      return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    }
    if (message === 'OTHER_BRANCH_TABLE') {
      return NextResponse.json({ error: 'That table belongs to another branch' }, { status: 400 })
    }
    if (message === 'BRANCH_DENIED') {
      return NextResponse.json({ error: 'You can only work with your own branch.', code: 'BRANCH_ACCESS_DENIED' }, { status: 403 })
    }
    if (message.startsWith('DOUBLE_BOOKED:')) {
      return NextResponse.json({ error: message.replace('DOUBLE_BOOKED:', ''), code: 'TABLE_DOUBLE_BOOKED' }, { status: 409 })
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
      // K4: a booking of another branch is refused
      const branchDenied = await assertRecordBranch(session, db, reservations, id)
      if (branchDenied) return branchDenied

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
