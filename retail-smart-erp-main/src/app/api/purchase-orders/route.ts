import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withAuthTenant, withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { purchaseOrders, purchaseOrderItems, suppliers, warehouses, users } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { logError } from '@/lib/ai/error-logger'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { purchaseOrdersListSchema, createPurchaseOrderSchema } from '@/lib/validation/schemas/purchases'

// Generate order number with transaction lock
async function generateOrderNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PO-${dateStr}-`

  // Find the highest number for today with FOR UPDATE lock (RLS filters by tenant)
  const existing = await tx
    .select({ orderNo: purchaseOrders.orderNo })
    .from(purchaseOrders)
    .where(ilike(purchaseOrders.orderNo, `${prefix}%`))
    .orderBy(desc(purchaseOrders.orderNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].orderNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

// GET all purchase orders for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, purchaseOrdersListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, status, supplierId: filterSupplierId, warehouseId: filterWarehouseId, sortBy, sortOrder: sortOrderParam } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(purchaseOrders.orderNo, `%${escaped}%`),
            ilike(suppliers.name, `%${escaped}%`)
          )!
        )
      }

      if (status) {
        conditions.push(eq(purchaseOrders.status, status))
      }

      if (filterSupplierId) {
        conditions.push(eq(purchaseOrders.supplierId, filterSupplierId))
      }

      if (filterWarehouseId) {
        conditions.push(eq(purchaseOrders.warehouseId, filterWarehouseId))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Build sort order
      const sortFn = sortOrderParam === 'asc' ? asc : desc
      const sortFieldMap: Record<string, typeof purchaseOrders.createdAt | typeof purchaseOrders.orderNo | typeof purchaseOrders.status | typeof purchaseOrders.total | typeof suppliers.name> = {
        createdAt: purchaseOrders.createdAt,
        orderNo: purchaseOrders.orderNo,
        status: purchaseOrders.status,
        total: purchaseOrders.total,
        supplierName: suppliers.name,
      }
      const orderByField = sortFieldMap[sortBy] || purchaseOrders.createdAt
      const orderByClause = sortFn(orderByField)

      // Return all purchase orders (for dropdowns)
      if (all) {
        const data = await db
          .select({
            id: purchaseOrders.id,
            orderNo: purchaseOrders.orderNo,
            supplierId: purchaseOrders.supplierId,
            supplierName: suppliers.name,
            warehouseId: purchaseOrders.warehouseId,
            warehouseName: warehouses.name,
            expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
            subtotal: purchaseOrders.subtotal,
            taxAmount: purchaseOrders.taxAmount,
            total: purchaseOrders.total,
            status: purchaseOrders.status,
            notes: purchaseOrders.notes,
            createdBy: purchaseOrders.createdBy,
            createdByName: users.fullName,
            approvedBy: purchaseOrders.approvedBy,
            approvedAt: purchaseOrders.approvedAt,
            cancellationReason: purchaseOrders.cancellationReason,
            cancelledAt: purchaseOrders.cancelledAt,
            tags: purchaseOrders.tags,
            createdAt: purchaseOrders.createdAt,
            updatedAt: purchaseOrders.updatedAt,
          })
          .from(purchaseOrders)
          .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
          .leftJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
          .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(1000)

        return { data, isAll: true }
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const data = await db
        .select({
          id: purchaseOrders.id,
          orderNo: purchaseOrders.orderNo,
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          warehouseId: purchaseOrders.warehouseId,
          warehouseName: warehouses.name,
          expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
          subtotal: purchaseOrders.subtotal,
          taxAmount: purchaseOrders.taxAmount,
          total: purchaseOrders.total,
          status: purchaseOrders.status,
          notes: purchaseOrders.notes,
          createdBy: purchaseOrders.createdBy,
          createdByName: users.fullName,
          approvedBy: purchaseOrders.approvedBy,
          approvedAt: purchaseOrders.approvedAt,
          cancellationReason: purchaseOrders.cancellationReason,
          cancelledAt: purchaseOrders.cancelledAt,
          tags: purchaseOrders.tags,
          createdAt: purchaseOrders.createdAt,
          updatedAt: purchaseOrders.updatedAt,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .leftJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
        .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if ('isAll' in result && result.isAll) {
      return NextResponse.json(result.data)
    }
    return NextResponse.json({ data: result.data, pagination: result.pagination })
  } catch (error) {
    logError('api/purchase-orders', error)
    return NextResponse.json(
      { error: 'Failed to fetch purchase orders' },
      { status: 500 }
    )
  }
}

// POST create new purchase order
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, createPurchaseOrderSchema)
  if (!parsed.success) return parsed.response
  const { supplierId, warehouseId, expectedDeliveryDate, notes, tags, items } = parsed.data

  // Quota check before transaction
  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quotaError = await requireQuota(preSession.user.tenantId, 'standard')
  if (quotaError) return quotaError

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }

    // Validate supplier exists (RLS filters by tenant)
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))

    if (!supplier) {
      return { error: NextResponse.json({ error: 'Supplier not found' }, { status: 404 }) }
    }

    // Validate warehouse exists (RLS filters by tenant)
    const [warehouse] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))

    if (!warehouse) {
      return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }
    }

    // Generate order number with lock
    const orderNo = await generateOrderNo(tx)

    // Create purchase order
    const [newOrder] = await tx.insert(purchaseOrders).values({
      tenantId: session.user.tenantId,
      orderNo,
      supplierId,
      warehouseId,
      expectedDeliveryDate: expectedDeliveryDate || null,
      notes: notes || null,
      tags: tags && tags.length > 0 ? JSON.stringify(tags) : null,
      status: 'draft',
      createdBy: session.user.id,
    }).returning()

    // Add items if provided
    if (items && items.length > 0) {
      let subtotal = 0
      let taxAmount = 0

      const orderItems = items.map((item) => {
        const itemTotal = item.quantity * item.unitPrice
        const itemTax = Math.max(0, item.tax || 0)
        subtotal += itemTotal
        taxAmount += itemTax

        return {
          tenantId: session.user.tenantId,
          purchaseOrderId: newOrder.id,
          itemId: item.itemId || null,
          itemName: item.itemName,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          tax: itemTax.toString(),
          total: (Math.round((itemTotal + itemTax) * 100) / 100).toString(),
        }
      })

      await tx.insert(purchaseOrderItems).values(orderItems)

      // Dual mode: try template-based tax recalculation
      const lineItems = items.map(item => ({
        itemId: item.itemId || null,
        lineTotal: item.quantity * item.unitPrice,
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })

      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        // Template configured — use computed values
        await tx.update(purchaseOrders)
          .set({
            subtotal: taxResult.subtotal.toString(),
            taxAmount: taxResult.totalTax.toString(),
            taxBreakdown: taxResult.taxBreakdown,
            total: taxResult.total.toString(),
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, newOrder.id))
      } else {
        // No template — use manual flat tax
        subtotal = Math.round(subtotal * 100) / 100
        taxAmount = Math.round(taxAmount * 100) / 100

        await tx.update(purchaseOrders)
          .set({
            subtotal: subtotal.toString(),
            taxAmount: taxAmount.toString(),
            total: (Math.round((subtotal + taxAmount) * 100) / 100).toString(),
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, newOrder.id))
      }
    }

    logAndBroadcast(session.user.tenantId, 'purchase-order', 'created', newOrder.id, {
      userId: session.user.id,
      entityName: newOrder.orderNo,
    })

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
