import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { workOrders, workOrderServices, workOrderParts, items, vehicles, customers, sales } from '@/lib/db/schema'
import { eq, desc, and, sql, or, ilike, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { generateActivityDescription } from '@/lib/utils/activity-log'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { roundCurrency } from '@/lib/utils/currency'
import { getAvailableStock, recalculateWorkOrderTotals } from '@/lib/dealership/work-orders'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { workOrdersListSchema, createWorkOrderSchema } from '@/lib/validation/schemas/work-orders'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { nextDocNo } from '@/lib/documents/numbering'

// GET all work orders for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Issue #96: Require permission to view work orders
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const parsed = validateSearchParams(request, workOrdersListSchema)
    if (!parsed.success) return parsed.response
    const { status, search, customerId, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const conditions = []
      if (customerId) {
        conditions.push(eq(workOrders.customerId, customerId))
      }
      if (status) {
        conditions.push(eq(workOrders.status, status))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(workOrders.orderNo, `%${escaped}%`),
            ilike(workOrders.customerName, `%${escaped}%`),
            ilike(workOrders.vehiclePlate, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.workOrders.findMany({
        where: whereClause,
        with: {
          customer: true,
          vehicle: {
            with: {
              vehicleType: true,
            },
          },
          assignedUser: SAFE_USER,
          services: {
            with: {
              serviceType: true,
            },
          },
          parts: {
            with: {
              item: true,
            },
          },
        },
        orderBy: [desc(workOrders.createdAt)],
        limit,
        offset,
      })

      // Fetch payment status for invoiced work orders
      const invoicedIds = result
        .filter(wo => wo.status === 'invoiced')
        .map(wo => wo.id)

      const salePaymentMap = new Map<string, { invoiceNo: string; saleTotal: string; paidAmount: string; saleStatus: string }>()

      if (invoicedIds.length > 0) {
        const saleRows = await db
          .select({
            workOrderId: sales.workOrderId,
            invoiceNo: sales.invoiceNo,
            total: sales.total,
            paidAmount: sales.paidAmount,
            status: sales.status,
          })
          .from(sales)
          .where(inArray(sales.workOrderId, invoicedIds))

        for (const row of saleRows) {
          if (row.workOrderId) {
            salePaymentMap.set(row.workOrderId, {
              invoiceNo: row.invoiceNo,
              saleTotal: row.total,
              paidAmount: row.paidAmount,
              saleStatus: row.status,
            })
          }
        }
      }

      // Attach payment status to work orders
      const enriched = result.map(wo => {
        const saleInfo = salePaymentMap.get(wo.id)
        if (!saleInfo) return { ...wo, paymentStatus: null, invoiceNo: null }

        const total = parseFloat(saleInfo.saleTotal)
        const paid = parseFloat(saleInfo.paidAmount)
        let paymentStatus: string
        if (saleInfo.saleStatus === 'void') {
          paymentStatus = 'void'
        } else if (paid >= total) {
          paymentStatus = 'paid'
        } else if (paid > 0) {
          paymentStatus = 'partial'
        } else {
          paymentStatus = 'unpaid'
        }

        return { ...wo, paymentStatus, invoiceNo: saleInfo.invoiceNo }
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(enriched)
      }

      return NextResponse.json({
        data: enriched,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/work-orders', error)
    return NextResponse.json({ error: 'Failed to fetch work orders' }, { status: 500 })
  }
}

// Helper function to calculate work order totals
function calculateTotals(services: { hours: number; rate: number }[], parts: { quantity: number; unitPrice: number; discount?: number }[]) {
  const servicesTotal = services.reduce((sum, s) => sum + roundCurrency(s.hours * s.rate), 0)
  const partsTotal = parts.reduce((sum, p) => sum + roundCurrency(p.quantity * p.unitPrice - (p.discount || 0)), 0)
  const subtotal = roundCurrency(servicesTotal + partsTotal)
  const taxAmount = 0 // Can be configured based on tenant settings
  const total = roundCurrency(subtotal + taxAmount)
  return { subtotal, taxAmount, total }
}

// POST create new work order
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // W8: Check permission
    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const parsed = await validateBody(request, createWorkOrderSchema)
    if (!parsed.success) return parsed.response
    const { customerId, vehicleId, priority, odometerIn, customerComplaint, assignedTo, warehouseId, costCenterId, services, parts, confirmCustomerMismatch } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Validate customerId belongs to tenant (RLS scopes the query)
      let customerSnapshot: string | null = null
      if (customerId) {
        const customer = await db.query.customers.findFirst({
          where: eq(customers.id, customerId),
        })
        if (!customer) {
          return NextResponse.json({ error: 'Invalid customer' }, { status: 400 })
        }
        customerSnapshot = customer.name
      }

      // Validate vehicleId and check customer ownership (RLS scopes the query)
      let vehiclePlateSnapshot: string | null = null
      let vehicleDescSnapshot: string | null = null
      if (vehicleId) {
        const vehicle = await db.query.vehicles.findFirst({
          where: eq(vehicles.id, vehicleId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Invalid vehicle' }, { status: 400 })
        }
        vehiclePlateSnapshot = vehicle.licensePlate || null
        vehicleDescSnapshot = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

        // Check if vehicle belongs to the specified customer
        if (customerId && vehicle.customerId && vehicle.customerId !== customerId && !confirmCustomerMismatch) {
          // Get vehicle owner's name for the warning
          const vehicleOwner = await db.query.customers.findFirst({
            where: eq(customers.id, vehicle.customerId),
          })
          return NextResponse.json({
            error: 'CUSTOMER_VEHICLE_MISMATCH',
            message: `This vehicle belongs to "${vehicleOwner?.name || 'another customer'}". Do you want to proceed?`,
            vehicleOwnerName: vehicleOwner?.name || 'another customer',
            vehicleOwnerId: vehicle.customerId,
          }, { status: 409 })
        }
      }

      // Validate stock availability in the work order's warehouse (same rule as adding parts
      // later: all active reservations count). Lines of the same item are checked together.
      const requestedByItem = new Map<string, number>()
      for (const part of parts) {
        requestedByItem.set(part.itemId, (requestedByItem.get(part.itemId) || 0) + part.quantity)
      }
      for (const [partItemId, requested] of requestedByItem) {
        const item = await db.query.items.findFirst({ where: eq(items.id, partItemId), columns: { name: true, trackStock: true } })
        if (!item) {
          return NextResponse.json({ error: 'Invalid part item' }, { status: 400 })
        }
        if (!item.trackStock) continue
        const available = await getAvailableStock(db, partItemId, warehouseId)
        if (requested > available) {
          return NextResponse.json({
            error: `Insufficient stock for "${item.name}". Available: ${available.toFixed(0)}, Requested: ${requested}`
          }, { status: 400 })
        }
      }

      // Provisional totals (recomputed with tax templates once the lines are stored)
      const { subtotal, taxAmount, total } = calculateTotals(services, parts)

      // Create work order in transaction with atomic order number generation
      const result = await db.transaction(async (tx) => {
        // Work order number from the per-tenant sequence
        const orderNo = await nextDocNo(tx, session.user.tenantId, 'work_order')

        const [newWorkOrder] = await tx.insert(workOrders).values({
          tenantId: session.user.tenantId,
          orderNo,
          customerId: customerId || null,
          vehicleId: vehicleId || null,
          warehouseId: warehouseId || null,
          customerName: customerSnapshot,
          vehiclePlate: vehiclePlateSnapshot,
          vehicleDescription: vehicleDescSnapshot,
          status: 'draft',
          priority: priority || 'normal',
          odometerIn,
          customerComplaint: customerComplaint || null,
          assignedTo: assignedTo || null,
          costCenterId: costCenterId || null,
          createdBy: userId,
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          total: String(total),
        }).returning()

        // Insert services if provided
        if (services.length > 0) {
          await tx.insert(workOrderServices).values(
            services.map((s) => ({
              tenantId: session.user.tenantId,
              workOrderId: newWorkOrder.id,
              serviceTypeId: s.serviceTypeId || null,
              description: s.description || null,
              hours: String(s.hours),
              rate: String(s.rate),
              amount: String(roundCurrency(s.hours * s.rate)),
            }))
          )
        }

        // Insert parts if provided
        if (parts.length > 0) {
          await tx.insert(workOrderParts).values(
            parts.map((p) => ({
              tenantId: session.user.tenantId,
              workOrderId: newWorkOrder.id,
              itemId: p.itemId,
              quantity: String(p.quantity),
              unitPrice: String(p.unitPrice),
              discount: String(p.discount || 0),
              total: String(roundCurrency(p.quantity * p.unitPrice - (p.discount || 0))),
            }))
          )
        }

        // Tax: same per-line template calculation the parts/services endpoints use
        if (services.length > 0 || parts.length > 0) {
          const totals = await recalculateWorkOrderTotals(tx, newWorkOrder.id, session.user.tenantId)
          return { ...newWorkOrder, subtotal: String(totals.subtotal), taxAmount: String(totals.taxAmount), taxBreakdown: totals.taxBreakdown, total: String(totals.total) }
        }

        return newWorkOrder
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'work-order', 'created', result.id, {
        userId,
        entityName: result.orderNo,
        description: generateActivityDescription('create', 'work order', result.orderNo),
      })

      return NextResponse.json(result)
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/work-orders', error)
    return NextResponse.json({ error: 'Failed to create work order' }, { status: 500 })
  }
}
