import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { appointments } from '@/lib/db/schema'
import { eq, and, inArray, gte } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { checkCustomerAppointmentsSchema } from '@/lib/validation/schemas/dealership'

// POST check for vehicle's existing scheduled/confirmed appointments
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, checkCustomerAppointmentsSchema)
  if (!parsed.success) return parsed.response
  const { vehicleId, excludeAppointmentId } = parsed.data

  if (!vehicleId) {
    return NextResponse.json({ existingAppointments: [] })
  }

  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return { error: permError }

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0]

    // Find upcoming scheduled/confirmed appointments for this vehicle (RLS filters by tenant)
    const existing = await db.query.appointments.findMany({
      where: and(
        eq(appointments.vehicleId, vehicleId),
        inArray(appointments.status, ['scheduled', 'confirmed']),
        gte(appointments.scheduledDate, today)
      ),
      with: {
        customer: true,
        serviceType: true,
      },
      orderBy: (appointments, { asc }) => [asc(appointments.scheduledDate), asc(appointments.scheduledTime)],
    })

    // Exclude current appointment if editing
    const filtered = excludeAppointmentId
      ? existing.filter(a => a.id !== excludeAppointmentId)
      : existing

    return {
      data: {
        existingAppointments: filtered.map(a => {
          const customer = Array.isArray(a.customer) ? a.customer[0] : a.customer
          const serviceType = Array.isArray(a.serviceType) ? a.serviceType[0] : a.serviceType
          return {
            id: a.id,
            scheduledDate: a.scheduledDate,
            scheduledTime: a.scheduledTime,
            status: a.status,
            customerName: customer?.name || null,
            serviceName: serviceType?.name || null,
          }
        }),
      }
    }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
