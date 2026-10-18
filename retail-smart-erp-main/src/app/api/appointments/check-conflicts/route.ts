import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { appointments } from '@/lib/db/schema'
import { eq, and, ne, or } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { checkAppointmentConflictsSchema } from '@/lib/validation/schemas/dealership'

// A18: Check for appointment time slot conflicts
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, checkAppointmentConflictsSchema)
  if (!parsed.success) return parsed.response
  const { scheduledDate, scheduledTime, durationMinutes, excludeAppointmentId } = parsed.data

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    // Calculate start and end times for the new appointment
    const [hours, minutes] = scheduledTime.split(':').map(Number)
    const startMinutes = hours * 60 + minutes
    const endMinutes = startMinutes + durationMinutes

    // Handle end time overflow past midnight
    const startTime = scheduledTime
    const cappedEndMinutes = Math.min(endMinutes, 23 * 60 + 59)
    const endHours = Math.floor(cappedEndMinutes / 60)
    const endMins = cappedEndMinutes % 60
    const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`

    // Build where conditions - RLS handles tenant filtering
    const conditions = [
      eq(appointments.scheduledDate, scheduledDate),
      or(
        eq(appointments.status, 'scheduled'),
        eq(appointments.status, 'confirmed'),
        eq(appointments.status, 'arrived')
      ),
    ]

    if (excludeAppointmentId) {
      conditions.push(ne(appointments.id, excludeAppointmentId))
    }

    // Find appointments on the same date
    const existingAppointments = await db.query.appointments.findMany({
      where: and(...conditions),
      with: {
        customer: { columns: { name: true } },
        serviceType: { columns: { name: true } },
      },
    })

    // Check for overlaps
    const conflicts: Array<{
      id: string
      customerName: string | null
      serviceName: string | null
      scheduledTime: string
      endTime: string
      overlapType: 'full' | 'partial_start' | 'partial_end' | 'contained'
    }> = []

    for (const apt of existingAppointments) {
      const [aptHours, aptMinutes] = apt.scheduledTime.split(':').map(Number)
      const aptStartMinutes = aptHours * 60 + aptMinutes
      const aptEndMinutes = aptStartMinutes + (apt.durationMinutes || 60)

      // Check if there's any overlap
      if (startMinutes < aptEndMinutes && endMinutes > aptStartMinutes) {
        let overlapType: 'full' | 'partial_start' | 'partial_end' | 'contained'

        if (startMinutes >= aptStartMinutes && endMinutes <= aptEndMinutes) {
          overlapType = 'contained'
        } else if (startMinutes <= aptStartMinutes && endMinutes >= aptEndMinutes) {
          overlapType = 'full'
        } else if (startMinutes < aptStartMinutes) {
          overlapType = 'partial_end'
        } else {
          overlapType = 'partial_start'
        }

        const cappedAptEndMinutes = Math.min(aptEndMinutes, 23 * 60 + 59)
        const aptEndHours = Math.floor(cappedAptEndMinutes / 60)
        const aptEndMins = cappedAptEndMinutes % 60

        const customer = Array.isArray(apt.customer) ? apt.customer[0] : apt.customer
        const serviceType = Array.isArray(apt.serviceType) ? apt.serviceType[0] : apt.serviceType
        conflicts.push({
          id: apt.id,
          customerName: customer?.name || null,
          serviceName: serviceType?.name || null,
          scheduledTime: apt.scheduledTime,
          endTime: `${String(aptEndHours).padStart(2, '0')}:${String(aptEndMins).padStart(2, '0')}`,
          overlapType,
        })
      }
    }

    return {
      data: {
        hasConflicts: conflicts.length > 0,
        conflicts,
        requestedSlot: { date: scheduledDate, startTime, endTime, durationMinutes },
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
