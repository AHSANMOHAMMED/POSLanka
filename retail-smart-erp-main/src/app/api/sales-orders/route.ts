import { resolveLineUnits, lineUnitErrorResponse, type ResolvedLineUnit } from '@/lib/units/resolve-line-units'
import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { salesOrders, salesOrderItems, customers, warehouses, users } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { salesOrdersListSchema, createSalesOrderSchema } from '@/lib/validation/schemas/sales'
import { nextDocNo } from '@/lib/documents/numbering'
import { getBranchScope, canAccessBranch, branchDeniedResponse, branchFilter, assertBranchAccess } from '@/lib/auth/branch-access'

// GET all sales orders for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, salesOrdersListSchema)
    if (!parsed.success) return parsed.response

    const { all, page, pageSize, search, status, customerId: filterCustomerId, warehouseId: filterWarehouseId, sortBy, sortOrder: sortOrderParam } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      // Module Access: refused when the owner switched this module off for the caller's role
      const moduleError = requireModule(session, 'selling')
      if (moduleError) return { moduleError }
      // Build where conditions - explicitly include tenantId for optimal index usage
      const conditions: ReturnType<typeof eq>[] = [
        eq(salesOrders.tenantId, session.user.tenantId)
      ]

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(salesOrders.orderNo, `%${escaped}%`),
            ilike(salesOrders.customerName, `%${escaped}%`)
          )!
        )
      }

      if (status) {
        conditions.push(eq(salesOrders.status, status as 'draft' | 'confirmed' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'))
      }

      if (filterCustomerId) {
        conditions.push(eq(salesOrders.customerId, filterCustomerId))
      }

      if (filterWarehouseId) {
        conditions.push(eq(salesOrders.warehouseId, filterWarehouseId))
      }
      // K4: branch-restricted users see their own branches' orders only
      const scope = await getBranchScope(session, db)
      if (filterWarehouseId && !canAccessBranch(scope, filterWarehouseId)) return { moduleError: await branchDeniedResponse(scope, db) }
      const branchCond = branchFilter(scope, salesOrders.warehouseId)
      if (branchCond) conditions.push(branchCond)

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Build sort order
      const sortFn = sortOrderParam === 'asc' ? asc : desc
      const sortFieldMap: Record<string, typeof salesOrders.createdAt | typeof salesOrders.orderNo | typeof salesOrders.status | typeof salesOrders.total> = {
        createdAt: salesOrders.createdAt,
        orderNo: salesOrders.orderNo,
        status: salesOrders.status,
        total: salesOrders.total,
      }
      const orderByField = sortFieldMap[sortBy] || salesOrders.createdAt
      const orderByClause = sortFn(orderByField)

      // Return all sales orders (for dropdowns)
      if (all) {
        const data = await db
          .select({
            id: salesOrders.id,
            orderNo: salesOrders.orderNo,
            customerId: salesOrders.customerId,
            customerName: salesOrders.customerName,
            warehouseId: salesOrders.warehouseId,
            warehouseName: warehouses.name,
            expectedDeliveryDate: salesOrders.expectedDeliveryDate,
            subtotal: salesOrders.subtotal,
            discountAmount: salesOrders.discountAmount,
            taxAmount: salesOrders.taxAmount,
            total: salesOrders.total,
            status: salesOrders.status,
            notes: salesOrders.notes,
            createdBy: salesOrders.createdBy,
            createdByName: users.fullName,
            cancellationReason: salesOrders.cancellationReason,
            cancelledAt: salesOrders.cancelledAt,
            confirmedAt: salesOrders.confirmedAt,
            createdAt: salesOrders.createdAt,
            updatedAt: salesOrders.updatedAt,
          })
          .from(salesOrders)
          .leftJoin(warehouses, eq(salesOrders.warehouseId, warehouses.id))
          .leftJoin(users, eq(salesOrders.createdBy, users.id))
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(1000)

        return { data, isAll: true }
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(salesOrders)
        .where(whereClause)

      const total = Number(count)
      if (total === 0) {
        return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }
      }
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const data = await db
        .select({
          id: salesOrders.id,
          orderNo: salesOrders.orderNo,
          customerId: salesOrders.customerId,
          customerName: salesOrders.customerName,
          warehouseId: salesOrders.warehouseId,
          warehouseName: warehouses.name,
          expectedDeliveryDate: salesOrders.expectedDeliveryDate,
          subtotal: salesOrders.subtotal,
          discountAmount: salesOrders.discountAmount,
          taxAmount: salesOrders.taxAmount,
          total: salesOrders.total,
          status: salesOrders.status,
          notes: salesOrders.notes,
          createdBy: salesOrders.createdBy,
          createdByName: users.fullName,
          cancellationReason: salesOrders.cancellationReason,
          cancelledAt: salesOrders.cancelledAt,
          confirmedAt: salesOrders.confirmedAt,
          createdAt: salesOrders.createdAt,
          updatedAt: salesOrders.updatedAt,
        })
        .from(salesOrders)
        .leftJoin(warehouses, eq(salesOrders.warehouseId, warehouses.id))
        .leftJoin(users, eq(salesOrders.createdBy, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('moduleError' in result) return result.moduleError

    if ('isAll' in result && result.isAll) {
      return NextResponse.json(result.data)
    }
    return NextResponse.json({ data: result.data, pagination: result.pagination })
  } catch (error) {
    logError('api/sales-orders', error)
    return NextResponse.json(
      { error: 'Failed to fetch sales orders' },
      { status: 500 }
    )
  }
}

// POST create new sales order
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, createSalesOrderSchema)
  if (!parsed.success) return parsed.response

  const { customerId, customerName, vehicleId, vehiclePlate, vehicleDescription, warehouseId, expectedDeliveryDate, deliveryAddress, notes, items } = parsed.data

  // A line discount is an amount; it can never exceed the line value (negative line totals)
  for (const item of items || []) {
    if ((item.discount || 0) > item.quantity * item.unitPrice + 0.001) {
      return NextResponse.json({ error: `Discount on ${item.itemName || 'an item'} exceeds the line amount` }, { status: 400 })
    }
  }

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'createSales')
    if (permError) return { error: permError }

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return { error: quotaError }

    // Validate warehouse exists (RLS filters by tenant)
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))

    if (!warehouse) {
      return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }
    }
    // K4: a branch-restricted user takes orders for their own branches only
    const branchDenied = await assertBranchAccess(session, warehouseId, tx)
    if (branchDenied) return { error: branchDenied }

    // Validate customer if provided
    if (customerId) {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, customerId))

      if (!customer) {
        return { error: NextResponse.json({ error: 'Customer not found' }, { status: 404 }) }
      }
    }

    // 0184: each line keeps its unit; the factor comes from item_uoms / standard units
    let units: ResolvedLineUnit[]
    try {
      units = await resolveLineUnits(tx, items || [])
    } catch (e) {
      const r = lineUnitErrorResponse(e)
      if (r) return { error: r }
      throw e
    }

    // Generate order number with lock
    const orderNo = await nextDocNo(tx, session.user.tenantId, 'sales_order')

    // Create sales order
    const [newOrder] = await tx.insert(salesOrders).values({
      tenantId: session.user.tenantId,
      orderNo,
      customerId: customerId || null,
      customerName: customerName || null,
      vehicleId: vehicleId || null,
      vehiclePlate: vehiclePlate || null,
      vehicleDescription: vehicleDescription || null,
      warehouseId,
      expectedDeliveryDate: expectedDeliveryDate || null,
      deliveryAddress: deliveryAddress || null,
      notes: notes || null,
      status: 'draft',
      createdBy: session.user.id,
    }).returning()

    // Add items if provided
    if (items && items.length > 0) {
      let subtotal = 0
      let totalDiscount = 0
      let totalTax = 0

      const orderItems = items.map((item, idx) => {
        const itemSubtotal = item.quantity * item.unitPrice
        const itemDiscount = Math.max(0, item.discount || 0)
        const itemTaxAmount = Math.max(0, item.taxAmount || item.tax || 0)
        subtotal += itemSubtotal
        totalDiscount += itemDiscount
        totalTax += itemTaxAmount
        const itemTotal = itemSubtotal - itemDiscount + itemTaxAmount

        return {
          tenantId: session.user.tenantId,
          salesOrderId: newOrder.id,
          itemId: item.itemId || null,
          itemName: item.itemName,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          discount: itemDiscount.toString(),
          discountType: item.discountType || null,
          tax: (item.tax || 0).toString(),
          taxAmount: itemTaxAmount.toString(),
          taxRate: (item.taxRate || 0).toString(),
          total: (Math.round(itemTotal * 100) / 100).toString(),
          uom: units[idx].uom,
          uomFactor: String(units[idx].factor),
        }
      })

      await tx.insert(salesOrderItems).values(orderItems)

      // Dual mode: try template-based tax recalculation
      const lineItems = items.map(item => ({
        itemId: item.itemId || null,
        lineTotal: item.quantity * item.unitPrice,
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'sales' })

      totalDiscount = Math.round(totalDiscount * 100) / 100

      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        // Template configured — use computed values
        await tx.update(salesOrders)
          .set({
            subtotal: taxResult.subtotal.toString(),
            discountAmount: totalDiscount.toString(),
            taxAmount: taxResult.totalTax.toString(),
            taxBreakdown: taxResult.taxBreakdown,
            total: (Math.round((taxResult.subtotal - totalDiscount + taxResult.totalTax) * 100) / 100).toString(),
            updatedAt: new Date(),
          })
          .where(eq(salesOrders.id, newOrder.id))
      } else {
        // No template — use manual flat tax
        subtotal = Math.round(subtotal * 100) / 100
        totalTax = Math.round(totalTax * 100) / 100

        await tx.update(salesOrders)
          .set({
            subtotal: subtotal.toString(),
            discountAmount: totalDiscount.toString(),
            taxAmount: totalTax.toString(),
            total: (Math.round((subtotal - totalDiscount + totalTax) * 100) / 100).toString(),
            updatedAt: new Date(),
          })
          .where(eq(salesOrders.id, newOrder.id))
      }
    }

    logAndBroadcast(session.user.tenantId, 'sales-order', 'created', newOrder.id)

    return { data: newOrder }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}
