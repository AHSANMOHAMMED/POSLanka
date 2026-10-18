import { NextRequest, NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/auth/resolve-user'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { appointments, workOrders, workOrderServices, customers, vehicles, serviceTypes, warehouses, tenants } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { triggerNotification } from '@/lib/notifications/auto-trigger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateAppointmentSchema } from '@/lib/validation/schemas/work-orders'
import { idParamSchema } from '@/lib/validation/schemas/common'

// A-C6: Helper to validate date/time is not in the past
// 8L: Uses configurable tenant timezone instead of hardcoded offset
function isDateTimeInPast(dateStr: string, timeStr: string, timezone: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hours, minutes] = timeStr.split(':').map(Number)

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })

  const nowParts = formatter.formatToParts(new Date())
  const nowInTz = new Date(
    parseInt(nowParts.find(p => p.type === 'year')!.value),
    parseInt(nowParts.find(p => p.type === 'month')!.value) - 1,
    parseInt(nowParts.find(p => p.type === 'day')!.value),
    parseInt(nowParts.find(p => p.type === 'hour')!.value),
    parseInt(nowParts.find(p => p.type === 'minute')!.value),
    parseInt(nowParts.find(p => p.type === 'second')!.value),
  )

  const appointmentInTz = new Date(year, month - 1, day, hours, minutes)
  const graceMs = 30 * 60 * 1000

  return appointmentInTz.getTime() < (nowInTz.getTime() - graceMs)
}

// A8: Valid MANUAL status transitions (arrived is automatic via work order)
const validManualStatusTransitions: Record<string, string[]> = {
  scheduled: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['cancelled', 'no_show'],
  arrived: [], // Status changes after arrived must go through work order completion
  completed: [], // Terminal state
  cancelled: [], // Terminal state
  no_show: [], // Terminal state
}

// GET single appointment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const appointment = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
      with: {
        customer: true,
        vehicle: true,
        serviceType: true,
        workOrder: true,
      },
    })

    if (!appointment) {
      return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
    }

    return { data: appointment }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update appointment
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateAppointmentSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  const { customerId, vehicleId, serviceTypeId, scheduledDate, scheduledTime, durationMinutes, status, notes, createWorkOrder, warehouseId, workOrderId, cancellationReason, expectedUpdatedAt } = body

  // If creating work order from appointment - use transaction
  if (createWorkOrder) {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageAppointments')
      if (permError) return { error: permError }

      const userId = await resolveUserId(session)

      // Lock appointment row
      const [lockedAppointment] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, id))
        .for('update')

      if (!lockedAppointment) {
        return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
      }

      if (lockedAppointment.workOrderId) {
        return { error: NextResponse.json({ error: 'Work order already exists for this appointment' }, { status: 400 }) }
      }

      // AEW-1: Validate warehouse - use provided or fall back to default active warehouse
      let effectiveWarehouseId = warehouseId
      if (!effectiveWarehouseId) {
        // Issue #22: Fall back to first active warehouse for the tenant
        const defaultWarehouse = await tx.query.warehouses.findFirst({
          where: eq(warehouses.isActive, true),
          orderBy: (warehouses, { asc }) => [asc(warehouses.createdAt)],
        })
        if (!defaultWarehouse) {
          return { error: NextResponse.json({ error: 'No active warehouses found. Please create a warehouse first.' }, { status: 400 }) }
        }
        effectiveWarehouseId = defaultWarehouse.id
      } else {
        const warehouse = await tx.query.warehouses.findFirst({
          where: and(eq(warehouses.id, effectiveWarehouseId), eq(warehouses.isActive, true)),
        })
        if (!warehouse) {
          return { error: NextResponse.json({ error: 'Invalid or inactive warehouse' }, { status: 400 }) }
        }
      }

      // AEW-2: Validate customer exists if specified
      if (lockedAppointment.customerId) {
        const customer = await tx.query.customers.findFirst({
          where: eq(customers.id, lockedAppointment.customerId),
        })
        if (!customer) {
          return { error: NextResponse.json({ error: 'Customer no longer exists' }, { status: 400 }) }
        }
      }

      // AEW-2: Validate vehicle exists if specified
      if (lockedAppointment.vehicleId) {
        const vehicle = await tx.query.vehicles.findFirst({
          where: eq(vehicles.id, lockedAppointment.vehicleId),
        })
        if (!vehicle) {
          return { error: NextResponse.json({ error: 'Vehicle no longer exists' }, { status: 400 }) }
        }
      }

      const validStatusesForWorkOrder = ['scheduled', 'confirmed', 'arrived']
      if (!validStatusesForWorkOrder.includes(lockedAppointment.status)) {
        return { error: NextResponse.json({
          error: `Cannot create work order for appointment with status '${lockedAppointment.status}'. Only scheduled, confirmed, or arrived appointments can be converted.`
        }, { status: 400 }) }
      }

      // Generate work order number
      const [maxResult] = await tx
        .select({ maxNo: sql<string>`MAX(${workOrders.orderNo})` })
        .from(workOrders)
        .for('update')

      const lastOrderNo = maxResult?.maxNo
      const nextNumber = lastOrderNo ? parseInt(lastOrderNo.replace(/\D/g, '')) + 1 : 1
      const orderNo = `WO-${String(nextNumber).padStart(6, '0')}`

      // Get service details if applicable
      let serviceToAdd = null
      if (lockedAppointment.serviceTypeId) {
        serviceToAdd = await tx.query.serviceTypes.findFirst({
          where: eq(serviceTypes.id, lockedAppointment.serviceTypeId),
        })
      }

      const defaultHours = serviceToAdd?.defaultHours ? parseFloat(serviceToAdd.defaultHours) : 1
      const defaultRate = serviceToAdd?.defaultRate ? parseFloat(serviceToAdd.defaultRate) : 0
      const initialAmount = defaultHours * defaultRate

      // Create work order (AEW-1: now includes warehouseId)
      const [newWorkOrder] = await tx.insert(workOrders).values({
        tenantId: session.user.tenantId,
        orderNo,
        customerId: lockedAppointment.customerId,
        vehicleId: lockedAppointment.vehicleId,
        warehouseId: effectiveWarehouseId, // AEW-1: Required for inventory tracking
        status: 'draft',
        priority: 'normal',
        createdBy: userId,
        customerComplaint: lockedAppointment.notes || null,
        subtotal: String(initialAmount),
        taxAmount: '0',
        total: String(initialAmount),
      }).returning()

      if (serviceToAdd && defaultRate > 0) {
        await tx.insert(workOrderServices).values({
          tenantId: session.user.tenantId,
          workOrderId: newWorkOrder.id,
          serviceTypeId: lockedAppointment.serviceTypeId,
          description: serviceToAdd.name,
          hours: String(defaultHours),
          rate: String(defaultRate),
          amount: String(initialAmount),
        })
      }

      const newStatus = ['scheduled', 'confirmed'].includes(lockedAppointment.status) ? 'arrived' : lockedAppointment.status
      await tx.update(appointments)
        .set({ workOrderId: newWorkOrder.id, status: newStatus, updatedAt: new Date() })
        .where(eq(appointments.id, id))

      logAndBroadcast(session.user.tenantId, 'appointment', 'updated', id)
      logAndBroadcast(session.user.tenantId, 'work-order', 'created', newWorkOrder.id)

      return {
        data: {
          appointment: { ...lockedAppointment, workOrderId: newWorkOrder.id, status: newStatus },
          workOrder: newWorkOrder
        }
      }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  }

  // Regular update
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    const userId = await resolveUserId(session)

    const currentAppointment = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
    })

    if (!currentAppointment) {
      return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
    }

    // 8L: Fetch tenant timezone for past-date validation
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
      columns: { timezone: true },
    })
    const timezone = tenant?.timezone || 'Asia/Colombo'

    // Optimistic locking
    if (expectedUpdatedAt) {
      const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
      const serverUpdatedAt = currentAppointment.updatedAt ? new Date(currentAppointment.updatedAt).getTime() : 0
      if (serverUpdatedAt > clientUpdatedAt) {
        return { error: NextResponse.json({
          error: 'Appointment was modified by another user. Please refresh and try again.',
          code: 'CONFLICT'
        }, { status: 409 }) }
      }
    }

    // Check if linked work order prevents editing
    if (currentAppointment.workOrderId) {
      const linkedWorkOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, currentAppointment.workOrderId),
      })

      if (linkedWorkOrder && linkedWorkOrder.status !== 'cancelled') {
        const hasEditableFieldChanges =
          (customerId !== undefined && customerId !== currentAppointment.customerId) ||
          (vehicleId !== undefined && vehicleId !== currentAppointment.vehicleId) ||
          (serviceTypeId !== undefined && serviceTypeId !== currentAppointment.serviceTypeId) ||
          (scheduledDate !== undefined && scheduledDate !== currentAppointment.scheduledDate) ||
          (scheduledTime !== undefined && scheduledTime !== currentAppointment.scheduledTime) ||
          (durationMinutes !== undefined && durationMinutes !== currentAppointment.durationMinutes)

        if (hasEditableFieldChanges) {
          return { error: NextResponse.json({
            error: 'Cannot edit appointment details while linked to an active work order. Cancel the work order first to make changes.',
            code: 'CONVERTED_APPOINTMENT'
          }, { status: 400 }) }
        }
      }
    }

    // Validate status transitions
    const validStatuses = ['scheduled', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show']
    if (status && !validStatuses.includes(status)) {
      return { error: NextResponse.json({ error: 'Invalid status' }, { status: 400 }) }
    }

    if (status && status !== currentAppointment.status) {
      const allowedTransitions = validManualStatusTransitions[currentAppointment.status] || []
      if (!allowedTransitions.includes(status)) {
        if (status === 'arrived') {
          return { error: NextResponse.json({
            error: 'Appointment status changes to "Arrived" automatically when a work order is created. Use the "Create Work Order" button instead.'
          }, { status: 400 }) }
        }
        if (status === 'completed' && currentAppointment.status === 'arrived') {
          return { error: NextResponse.json({
            error: 'Appointment status changes to "Completed" when the linked work order is completed.'
          }, { status: 400 }) }
        }
        return { error: NextResponse.json({
          error: `Cannot change status from '${currentAppointment.status}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none (terminal state)'}`
        }, { status: 400 }) }
      }
    }

    // Validate date/time not in past
    if (scheduledDate && scheduledTime && isDateTimeInPast(scheduledDate, scheduledTime, timezone)) {
      return { error: NextResponse.json({ error: 'Cannot reschedule appointment to the past' }, { status: 400 }) }
    }
    if (scheduledDate && !scheduledTime && isDateTimeInPast(scheduledDate, currentAppointment.scheduledTime, timezone)) {
      return { error: NextResponse.json({ error: 'Cannot reschedule appointment to the past' }, { status: 400 }) }
    }
    if (!scheduledDate && scheduledTime && isDateTimeInPast(currentAppointment.scheduledDate, scheduledTime, timezone)) {
      return { error: NextResponse.json({ error: 'Cannot reschedule appointment to the past' }, { status: 400 }) }
    }

    // Validate foreign keys
    if (customerId) {
      const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) })
      if (!customer) return { error: NextResponse.json({ error: 'Invalid customer' }, { status: 400 }) }
    }
    if (vehicleId) {
      const vehicle = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) })
      if (!vehicle) return { error: NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 }) }
    }
    if (serviceTypeId) {
      const serviceType = await db.query.serviceTypes.findFirst({ where: eq(serviceTypes.id, serviceTypeId) })
      if (!serviceType) return { error: NextResponse.json({ error: 'Invalid service type' }, { status: 400 }) }
    }

    // Handle linking to existing work order
    let autoStatus: string | undefined
    if (workOrderId && !currentAppointment.workOrderId && ['scheduled', 'confirmed'].includes(currentAppointment.status)) {
      const linkedWorkOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })
      if (!linkedWorkOrder) {
        return { error: NextResponse.json({ error: 'Invalid work order' }, { status: 400 }) }
      }
      autoStatus = 'arrived'

      if (currentAppointment.notes) {
        let newComplaint = currentAppointment.notes
        if (linkedWorkOrder.customerComplaint) {
          newComplaint = `${linkedWorkOrder.customerComplaint}\n\n[From Appointment ${currentAppointment.scheduledDate}]\n${currentAppointment.notes}`
        }
        await db.update(workOrders)
          .set({ customerComplaint: newComplaint, updatedAt: new Date() })
          .where(eq(workOrders.id, workOrderId))
      }
    }

    const updateData: Record<string, unknown> = {
      customerId: customerId !== undefined ? (customerId || null) : undefined,
      vehicleId: vehicleId !== undefined ? (vehicleId || null) : undefined,
      serviceTypeId: serviceTypeId !== undefined ? (serviceTypeId || null) : undefined,
      scheduledDate: scheduledDate || undefined,
      scheduledTime: scheduledTime || undefined,
      durationMinutes: durationMinutes !== undefined ? durationMinutes : undefined,
      status: status || autoStatus || undefined,
      notes: notes !== undefined ? (notes || null) : undefined,
      workOrderId: workOrderId !== undefined ? workOrderId : undefined,
      updatedAt: new Date(),
    }

    if (status === 'cancelled') {
      updateData.cancellationReason = cancellationReason || null
      updateData.cancelledAt = new Date()
    }

    const [updated] = await db.update(appointments)
      .set(updateData)
      .where(eq(appointments.id, id))
      .returning()

    if (!updated) {
      return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
    }

    // Broadcast + log activity
    const appointmentLabel = `${updated.scheduledDate} at ${updated.scheduledTime}`
    let actionDescription = generateActivityDescription('update', 'appointment', appointmentLabel)
    if (status && status !== currentAppointment.status) {
      actionDescription = status === 'cancelled'
        ? `Cancelled appointment for ${appointmentLabel}`
        : `Changed appointment status to '${status}' for ${appointmentLabel}`
    } else {
      // Build field-level change descriptions when no status change
      const changes: string[] = []
      if (notes !== undefined && notes !== currentAppointment.notes) {
        changes.push('notes updated')
      }
      if (scheduledDate !== undefined && scheduledDate !== currentAppointment.scheduledDate) {
        changes.push(`date → ${scheduledDate}`)
      }
      if (scheduledTime !== undefined && scheduledTime !== currentAppointment.scheduledTime) {
        changes.push(`time → ${scheduledTime}`)
      }
      if (durationMinutes !== undefined && durationMinutes !== currentAppointment.durationMinutes) {
        changes.push(`duration → ${durationMinutes}min`)
      }
      if (changes.length > 0) {
        actionDescription = `${appointmentLabel}: ${changes.join('; ')}`
      }
    }

    logAndBroadcast(session.user.tenantId, 'appointment', 'updated', id, {
      userId: userId || undefined,
      activityAction: status === 'cancelled' ? 'cancel' : 'update',
      entityName: appointmentLabel,
      description: actionDescription,
    })
    if (workOrderId && !currentAppointment.workOrderId && currentAppointment.notes) {
      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)
    }

    // Fire-and-forget notification triggers for status changes
    if (status === 'confirmed' && status !== currentAppointment.status) {
      triggerNotification(session.user.tenantId, 'appointment_confirmed', {
        tenantId: session.user.tenantId,
        customerId: updated.customerId,
        appointmentId: id,
      }).catch(() => {})
    }

    return { data: updated }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}

// DELETE appointment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    const userId = await resolveUserId(session)

    // Check if appointment exists (RLS filters by tenant)
    const existingAppointment = await tx.query.appointments.findFirst({
      where: eq(appointments.id, id),
    })

    if (!existingAppointment) {
      return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
    }

    if (existingAppointment.status === 'arrived') {
      return { error: NextResponse.json({
        error: 'Cannot delete an appointment after customer has arrived. Cancel the appointment instead.',
        code: 'ARRIVED_APPOINTMENT'
      }, { status: 400 }) }
    }

    if (existingAppointment.status === 'completed') {
      return { error: NextResponse.json({
        error: 'Cannot delete a completed appointment.',
        code: 'COMPLETED_APPOINTMENT'
      }, { status: 400 }) }
    }

    if (existingAppointment.workOrderId) {
      const linkedWorkOrder = await tx.query.workOrders.findFirst({
        where: eq(workOrders.id, existingAppointment.workOrderId),
      })

      if (linkedWorkOrder && linkedWorkOrder.status !== 'cancelled') {
        return { error: NextResponse.json({
          error: 'Cannot delete appointment while linked to an active work order. Cancel the work order first.',
          code: 'CONVERTED_APPOINTMENT'
        }, { status: 400 }) }
      }
    }

    // Check for child appointments
    const childAppointments = await tx.query.appointments.findMany({
      where: eq(appointments.parentAppointmentId, id),
    })

    // Check if any child has arrived/completed status or active work orders
    for (const child of childAppointments) {
      if (child.status === 'arrived') {
        return { error: NextResponse.json({
          error: `Cannot delete recurring series. A child appointment (${child.scheduledDate}) has customer arrived.`,
          code: 'CHILD_ARRIVED'
        }, { status: 400 }) }
      }
      if (child.status === 'completed') {
        return { error: NextResponse.json({
          error: `Cannot delete recurring series. A child appointment (${child.scheduledDate}) is completed.`,
          code: 'CHILD_COMPLETED'
        }, { status: 400 }) }
      }
      if (child.workOrderId) {
        const childWorkOrder = await tx.query.workOrders.findFirst({
          where: eq(workOrders.id, child.workOrderId),
        })
        if (childWorkOrder && childWorkOrder.status !== 'cancelled') {
          return { error: NextResponse.json({
            error: `Cannot delete recurring series. A child appointment (${child.scheduledDate}) has an active work order.`,
            code: 'CHILD_HAS_WORK_ORDER'
          }, { status: 400 }) }
        }
      }
    }

    // Delete all child appointments first
    if (childAppointments.length > 0) {
      await tx.delete(appointments)
        .where(eq(appointments.parentAppointmentId, id))
    }

    // Delete the parent appointment
    const [deleted] = await tx.delete(appointments)
      .where(eq(appointments.id, id))
      .returning()

    if (!deleted) {
      return { error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
    }

    // Broadcast + log activity
    const appointmentLabel = `${existingAppointment.scheduledDate} at ${existingAppointment.scheduledTime}`
    logAndBroadcast(session.user.tenantId, 'appointment', 'deleted', id, {
      userId: userId || undefined,
      entityName: appointmentLabel,
      description: childAppointments.length > 0
        ? `Deleted recurring appointment series (${childAppointments.length + 1} total) for ${appointmentLabel}`
        : generateActivityDescription('delete', 'appointment', appointmentLabel),
    })

    return { data: { success: true, childrenDeleted: childAppointments.length } }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
