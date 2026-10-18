import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { testDrives, vehicleInventory, vehicleMakes, vehicleModels, customers } from '@/lib/db/schema'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { testDrivesListSchema, createTestDriveSchema } from '@/lib/validation/schemas/dealership'

// GET all test drives for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, testDrivesListSchema)
    if (!parsed.success) return parsed.response
    const { status, vehicleInventoryId, customerId, dateFrom, dateTo, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (status) {
        conditions.push(eq(testDrives.status, status))
      }
      if (vehicleInventoryId) {
        conditions.push(eq(testDrives.vehicleInventoryId, vehicleInventoryId))
      }
      if (customerId) {
        conditions.push(eq(testDrives.customerId, customerId))
      }
      if (dateFrom) {
        conditions.push(gte(testDrives.scheduledDate, dateFrom))
      }
      if (dateTo) {
        conditions.push(lte(testDrives.scheduledDate, dateTo))
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(testDrives)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get test drives with related data
      const result = await db
        .select({
          testDrive: testDrives,
          vehicleMakeName: vehicleMakes.name,
          vehicleModelName: vehicleModels.name,
          vehicleYear: vehicleInventory.year,
          vehicleStockNo: vehicleInventory.stockNo,
          customerName: customers.name,
          customerPhone: customers.phone,
        })
        .from(testDrives)
        .leftJoin(vehicleInventory, eq(testDrives.vehicleInventoryId, vehicleInventory.id))
        .leftJoin(vehicleMakes, eq(vehicleInventory.makeId, vehicleMakes.id))
        .leftJoin(vehicleModels, eq(vehicleInventory.modelId, vehicleModels.id))
        .leftJoin(customers, eq(testDrives.customerId, customers.id))
        .where(whereClause)
        .orderBy(desc(testDrives.scheduledDate))
        .limit(limit)
        .offset(offset ?? 0)

      const data = result.map(r => ({
        ...r.testDrive,
        vehicleMake: r.vehicleMakeName,
        vehicleModel: r.vehicleModelName,
        vehicleYear: r.vehicleYear,
        vehicleStockNo: r.vehicleStockNo,
        customerName: r.customerName || r.testDrive.customerName,
        customerPhone: r.customerPhone || r.testDrive.customerPhone,
      }))

      // Return paginated response
      if (all) {
        return NextResponse.json(data)
      }

      return NextResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/test-drives', error)
    return NextResponse.json({ error: 'Failed to fetch test drives' }, { status: 500 })
  }
}

// POST create new test drive
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageAppointments')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createTestDriveSchema)
    if (!parsed.success) return parsed.response
    const {
      vehicleInventoryId, customerId, salespersonId,
      scheduledDate, scheduledTime, durationMinutes,
      customerName, customerPhone, customerEmail,
      notes,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate vehicle exists and is available
      const vehicle = await db.query.vehicleInventory.findFirst({
        where: eq(vehicleInventory.id, vehicleInventoryId),
      })
      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 400 })
      }
      if (!vehicle.isActive) {
        return NextResponse.json({ error: 'Vehicle is not active' }, { status: 400 })
      }

      // Validate customer if provided
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
        }
      }

      const [newTestDrive] = await db.insert(testDrives).values({
        tenantId: session.user.tenantId,
        vehicleInventoryId,
        customerId: customerId || null,
        salespersonId: salespersonId || session.user.id,
        scheduledDate,
        scheduledTime: scheduledTime || null,
        durationMinutes,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        notes: notes || null,
        status: 'scheduled',
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'test-drive', 'created', newTestDrive.id)

      return NextResponse.json(newTestDrive)
    })
  } catch (error) {
    logError('api/test-drives', error)
    return NextResponse.json({ error: 'Failed to create test drive' }, { status: 500 })
  }
}
