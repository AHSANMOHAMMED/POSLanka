import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { reservations, restaurantTables, customers } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike, gte, lte } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { reservationsListSchema, createReservationSchema } from '@/lib/validation/schemas/restaurant'

function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars (0,O,1,I)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// GET all reservations for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, reservationsListSchema)
    if (!parsed.success) return parsed.response
    const { status, tableId, date, fromDate, toDate, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = []

      if (status) {
        conditions.push(eq(reservations.status, status))
      }

      if (tableId) {
        conditions.push(eq(reservations.tableId, tableId))
      }

      if (date) {
        conditions.push(eq(reservations.reservationDate, date))
      }

      if (fromDate) {
        conditions.push(gte(reservations.reservationDate, fromDate))
      }

      if (toDate) {
        conditions.push(lte(reservations.reservationDate, toDate))
      }

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(reservations.customerName, `%${escaped}%`),
            ilike(reservations.customerPhone, `%${escaped}%`),
            ilike(reservations.customerEmail, `%${escaped}%`),
            ilike(reservations.confirmationCode, `%${escaped}%`)
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.reservations.findMany({
        where: whereClause,
        with: {
          table: true,
          customer: true,
        },
        orderBy: [desc(reservations.reservationDate), desc(reservations.reservationTime)],
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
        }
      })
    })
  } catch (error) {
    logError('api/reservations', error)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

// POST create new reservation
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createReservationSchema)
    if (!parsed.success) return parsed.response
    const {
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      tableId,
      reservationDate,
      reservationTime,
      partySize,
      estimatedDuration,
      notes,
      specialRequests,
      source,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate table if provided
      if (tableId) {
        const table = await db.query.restaurantTables.findFirst({
          where: eq(restaurantTables.id, tableId),
        })
        if (!table) {
          return NextResponse.json({ error: 'Table not found' }, { status: 404 })
        }
      }

      // Validate customer if provided
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
        }
      }

      // Generate unique confirmation code
      let confirmationCode = generateConfirmationCode()
      let attempts = 0
      while (attempts < 10) {
        const existing = await db.query.reservations.findFirst({
          where: eq(reservations.confirmationCode, confirmationCode),
        })
        if (!existing) break
        confirmationCode = generateConfirmationCode()
        attempts++
      }

      // Create reservation
      const result = await db.insert(reservations).values({
        tenantId: session.user.tenantId,
        customerId: customerId || null,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        tableId: tableId || null,
        reservationDate,
        reservationTime,
        partySize,
        estimatedDuration,
        status: 'pending',
        notes: notes || null,
        specialRequests: specialRequests || null,
        source,
        confirmationCode,
        createdBy: userId,
      }).returning()

      const newReservation = (result as typeof reservations.$inferSelect[])[0]

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'reservation', 'created', newReservation.id)

      return NextResponse.json(newReservation)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/reservations', error)
    return NextResponse.json({ error: 'Failed to create reservation' }, { status: 500 })
  }
}
