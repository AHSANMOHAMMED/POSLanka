import { NextRequest, NextResponse } from 'next/server'
import { resolveUserIdRequired } from '@/lib/auth'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { appointments, customers, vehicles, serviceTypes, tenants } from '@/lib/db/schema'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createAppointmentSchema } from '@/lib/validation/schemas/work-orders'

// A-C6: Helper to validate date/time is not in the past
// 8L: Uses configurable tenant timezone instead of hardcoded offset
function isDateTimeInPast(dateStr: string, timeStr: string, timezone: string): boolean {
  // Format: YYYY-MM-DD and HH:MM
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hours, minutes] = timeStr.split(':').map(Number)

  // Use Intl.DateTimeFormat to get the UTC offset for the tenant's timezone
  // Create a date in the tenant's local time, then compare with current time
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })

  // Get current time in the tenant's timezone
  const nowParts = formatter.formatToParts(new Date())
  const nowInTz = new Date(
    parseInt(nowParts.find(p => p.type === 'year')!.value),
    parseInt(nowParts.find(p => p.type === 'month')!.value) - 1,
    parseInt(nowParts.find(p => p.type === 'day')!.value),
    parseInt(nowParts.find(p => p.type === 'hour')!.value),
    parseInt(nowParts.find(p => p.type === 'minute')!.value),
    parseInt(nowParts.find(p => p.type === 'second')!.value),
  )

  // Create the appointment date/time as comparable local value
  const appointmentInTz = new Date(year, month - 1, day, hours, minutes)

  // Allow 30 minutes grace period
  const graceMs = 30 * 60 * 1000

  return appointmentInTz.getTime() < (nowInTz.getTime() - graceMs)
}

// GET all appointments for the tenant (with pagination)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const status = searchParams.get('status')
  const workOrderId = searchParams.get('workOrderId')
  const search = searchParams.get('search') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '25')
  const all = searchParams.get('all') === 'true'

  // Validate UUID format for optional ID params
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (workOrderId && !UUID_RE.test(workOrderId)) {
    return NextResponse.json({ error: 'Invalid workOrderId format' }, { status: 400 })
  }

  const result = await withAuthTenant(async (session, db) => {
    // Issue #97: Require permission to view appointments
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    // Build where conditions - RLS handles tenant filtering
    const conditions: ReturnType<typeof eq>[] = []
    if (workOrderId) {
      conditions.push(eq(appointments.workOrderId, workOrderId))
    }
    if (status) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conditions.push(eq(appointments.status, status as any))
    }
    if (startDate) {
      conditions.push(gte(appointments.scheduledDate, startDate))
    }
    if (endDate) {
      conditions.push(lte(appointments.scheduledDate, endDate))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count for pagination
    const [{ count: totalCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(whereClause)

    // Calculate pagination
    const limit = all ? 1000 : Math.min(pageSize, 100)
    const offset = all ? undefined : (page - 1) * pageSize

    // For search, we need to fetch more and filter (search includes customer/vehicle)
    const fetchLimit = search ? undefined : limit
    const fetchOffset = search ? undefined : offset

    let data = await db.query.appointments.findMany({
      where: whereClause,
      with: {
        customer: true,
        vehicle: true,
        serviceType: true,
        workOrder: true,
      },
      orderBy: [desc(appointments.scheduledDate)],
      limit: fetchLimit,
      offset: fetchOffset,
    })

    // Apply search filter if provided
    let filteredTotal = totalCount
    if (search) {
      const searchLower = search.toLowerCase()
      data = data.filter(apt => {
        const customer = Array.isArray(apt.customer) ? apt.customer[0] : apt.customer
        const vehicle = Array.isArray(apt.vehicle) ? apt.vehicle[0] : apt.vehicle
        const serviceType = Array.isArray(apt.serviceType) ? apt.serviceType[0] : apt.serviceType
        const customerMatch = customer?.name?.toLowerCase().includes(searchLower)
        const vehicleMatch = vehicle && (
          vehicle.licensePlate?.toLowerCase().includes(searchLower) ||
          vehicle.make?.toLowerCase().includes(searchLower) ||
          vehicle.model?.toLowerCase().includes(searchLower)
        )
        const serviceMatch = serviceType?.name?.toLowerCase().includes(searchLower)
        const notesMatch = apt.notes?.toLowerCase().includes(searchLower)
        return customerMatch || vehicleMatch || serviceMatch || notesMatch
      })
      filteredTotal = data.length
      if (!all) {
        data = data.slice(offset || 0, (offset || 0) + (limit || pageSize))
      }
    }

    if (all) {
      return { data, isAll: true }
    }

    return {
      data,
      pagination: {
        page,
        pageSize,
        total: search ? filteredTotal : totalCount,
        totalPages: Math.ceil((search ? filteredTotal : totalCount) / pageSize),
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  if ('isAll' in result && result.isAll) {
    return NextResponse.json(result.data)
  }

  return NextResponse.json({ data: result.data, pagination: result.pagination })
}

// A17: Helper to calculate next date based on recurrence pattern
function getNextDate(currentDate: Date, pattern: string): Date {
  const next = new Date(currentDate)
  switch (pattern) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      break
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'biweekly':
      next.setDate(next.getDate() + 14)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      break
  }
  return next
}

// A17: Format date to YYYY-MM-DD
function formatDateToISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

// POST create new appointment
export async function POST(request: NextRequest) {
  try {
  const parsed = await validateBody(request, createAppointmentSchema)
  if (!parsed.success) return parsed.response

  const {
    customerId, vehicleId, serviceTypeId, scheduledDate, scheduledTime, durationMinutes: duration, notes,
    recurrencePattern: pattern, recurrenceEndDate,
    confirmCustomerMismatch
  } = parsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    // Check permission
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    // 8L: Fetch tenant timezone for past-date validation
    const tenant = await tx.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
      columns: { timezone: true },
    })
    const timezone = tenant?.timezone || 'Asia/Colombo'

    // Issue #23: Notes are optional - validate date not in the past
    if (isDateTimeInPast(scheduledDate, scheduledTime, timezone)) {
      return { error: NextResponse.json({ error: 'Cannot schedule appointments in the past' }, { status: 400 }) }
    }

    // Resolve valid user ID
    const userId = await resolveUserIdRequired(session)

    // Verify foreign keys (RLS filters by tenant)
    const customer = await tx.query.customers.findFirst({
      where: eq(customers.id, customerId),
    })
    if (!customer) {
      return { error: NextResponse.json({ error: 'Invalid customer' }, { status: 400 }) }
    }

    const vehicle = await tx.query.vehicles.findFirst({
      where: eq(vehicles.id, vehicleId),
    })
    if (!vehicle) {
      return { error: NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 }) }
    }

    // Check if vehicle belongs to the specified customer
    if (vehicle.customerId && vehicle.customerId !== customerId && !confirmCustomerMismatch) {
      const vehicleOwner = await tx.query.customers.findFirst({
        where: eq(customers.id, vehicle.customerId),
      })
      return { error: NextResponse.json({
        error: 'CUSTOMER_VEHICLE_MISMATCH',
        message: `This vehicle belongs to "${vehicleOwner?.name || 'another customer'}". Do you want to proceed?`,
        vehicleOwnerName: vehicleOwner?.name || 'another customer',
        vehicleOwnerId: vehicle.customerId,
      }, { status: 409 }) }
    }

    const serviceType = await tx.query.serviceTypes.findFirst({
      where: eq(serviceTypes.id, serviceTypeId),
    })
    if (!serviceType) {
      return { error: NextResponse.json({ error: 'Invalid service type' }, { status: 400 }) }
    }

    // Create the first (parent) appointment
    const [parent] = await tx.insert(appointments).values({
      tenantId: session.user.tenantId,
      customerId: customerId || null,
      vehicleId: vehicleId || null,
      serviceTypeId: serviceTypeId || null,
      scheduledDate,
      scheduledTime,
      durationMinutes: duration,
      status: 'scheduled',
      notes: notes || null,
      recurrencePattern: pattern,
      recurrenceEndDate: pattern !== 'none' ? recurrenceEndDate : null,
      parentAppointmentId: null,
    }).returning()

    const created = [parent]

    // Create recurring appointments if pattern is set
    if (pattern !== 'none' && recurrenceEndDate) {
      const endDate = new Date(recurrenceEndDate + 'T23:59:59')
      let currentDate = new Date(scheduledDate + 'T00:00:00')
      const maxOccurrences = 52

      let count = 0
      while (count < maxOccurrences) {
        currentDate = getNextDate(currentDate, pattern)
        if (currentDate > endDate) break

        const [recurring] = await tx.insert(appointments).values({
          tenantId: session.user.tenantId,
          customerId: customerId || null,
          vehicleId: vehicleId || null,
          serviceTypeId: serviceTypeId || null,
          scheduledDate: formatDateToISO(currentDate),
          scheduledTime,
          durationMinutes: duration,
          status: 'scheduled',
          notes: notes || null,
          recurrencePattern: pattern,
          recurrenceEndDate: recurrenceEndDate,
          parentAppointmentId: parent.id,
        }).returning()

        created.push(recurring)
        count++
      }
    }

    // Broadcast + log activity
    const appointmentLabel = `${scheduledDate} at ${scheduledTime}`
    logAndBroadcast(session.user.tenantId, 'appointment', 'created', parent.id, {
      userId,
      entityName: appointmentLabel,
      description: generateActivityDescription('create', 'appointment', appointmentLabel),
      metadata: pattern !== 'none' ? { totalCreated: created.length, isRecurring: true } : undefined,
    })

    return {
      data: {
        appointment: parent,
        totalCreated: created.length,
        isRecurring: pattern !== 'none',
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/appointments', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}
