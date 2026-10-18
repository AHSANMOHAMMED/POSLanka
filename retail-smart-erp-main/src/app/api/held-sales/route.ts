import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { heldSales, customers, vehicles } from '@/lib/db/schema'
import { eq, desc, sql, gt } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { heldSalesListSchema, createHeldSaleSchema } from '@/lib/validation/schemas/held-sales'

// Default expiration time in hours
const DEFAULT_EXPIRATION_HOURS = 24

// GET all held sales for the tenant
// Query params:
//   - includeExpired: 'true' to include expired held sales (default: false)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, heldSalesListSchema)
    if (!parsed.success) return parsed.response
    const { includeExpired } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where condition based on includeExpired flag
      const whereCondition = includeExpired
        ? undefined  // No filter - include all
        : gt(heldSales.expiresAt, sql`NOW()`)  // Only non-expired

      const result = await db.query.heldSales.findMany({
        where: whereCondition,
        with: {
          customer: true,
          vehicle: true,
          heldByUser: true,
        },
        orderBy: [desc(heldSales.createdAt)],
      })

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/held-sales', error)
    return NextResponse.json({ error: 'Failed to fetch held sales' }, { status: 500 })
  }
}

// POST create new held sale (hold current cart)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createHeldSaleSchema)
    if (!parsed.success) return parsed.response
    const { customerId, vehicleId, cartItems, subtotal, notes, customerName, vehiclePlate, vehicleDescription, warehouseId, expirationHours } = parsed.data

    // Calculate expiration timestamp
    const validExpirationHours = expirationHours ?? DEFAULT_EXPIRATION_HOURS
    const expiresAt = new Date(Date.now() + validExpirationHours * 60 * 60 * 1000)

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Variables for denormalized fields
      let resolvedCustomerName = customerName
      let resolvedVehiclePlate = vehiclePlate
      let resolvedVehicleDescription = vehicleDescription

      // Validate foreign keys belong to tenant (RLS scopes the query)
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        }
        if (!resolvedCustomerName) {
          resolvedCustomerName = customer.name
        }
      }

      if (vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 })
        }
        if (!resolvedVehiclePlate) {
          resolvedVehiclePlate = vehicle.licensePlate
        }
        if (!resolvedVehicleDescription) {
          resolvedVehicleDescription = `${vehicle.year ? `${vehicle.year} ` : ''}${vehicle.make} ${vehicle.model}`
        }
      }

      // Create held sale in transaction with atomic number generation (RLS scopes)
      const result = await db.transaction(async (tx) => {
        // Advisory lock to prevent duplicate hold numbers under concurrency
        await tx.execute(sql`SELECT pg_advisory_xact_lock(5)`)

        // Generate hold number atomically
        const [maxResult] = await tx
          .select({ maxNo: sql<string>`MAX(${heldSales.holdNumber})` })
          .from(heldSales)

        const lastHoldNo = maxResult?.maxNo
        const nextNumber = lastHoldNo ? parseInt(lastHoldNo.replace(/\D/g, '')) + 1 : 1
        const holdNumber = `HOLD-${String(nextNumber).padStart(4, '0')}`

        const [newHeldSale] = await tx.insert(heldSales).values({
          tenantId: session.user.tenantId,
          holdNumber,
          customerId: customerId || null,
          vehicleId: vehicleId || null,
          warehouseId: warehouseId || null,
          // Denormalized fields for display
          customerName: resolvedCustomerName || null,
          vehiclePlate: resolvedVehiclePlate || null,
          vehicleDescription: resolvedVehicleDescription || null,
          cartItems: cartItems,
          subtotal: String(subtotal || 0),
          notes: notes || null,
          heldBy: userId,
          expiresAt: expiresAt,
        }).returning()

        return newHeldSale
      })

      // Broadcast the change
      logAndBroadcast(session.user.tenantId, 'held-sale', 'created', result.id)
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', '', { userId: session.user.id })

      return NextResponse.json(result)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/held-sales', error)
    return NextResponse.json({ error: 'Failed to hold sale' }, { status: 500 })
  }
}
