import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withAuthTenant, withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { purchases, purchaseItems, suppliers, warehouses, users, purchaseOrders } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { auditPurchaseIntegrity } from '@/lib/audit/realtime-hooks'
import { checkPurchaseAnomalies } from '@/lib/ai/anomaly-detector'
import { logError } from '@/lib/ai/error-logger'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { purchasesListSchema, createPurchaseSchema } from '@/lib/validation/schemas/purchases'

// Generate purchase number with transaction lock to prevent race conditions
async function generatePurchaseNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PI-${dateStr}-`

  // Find the highest number for today with FOR UPDATE lock
  // RLS automatically filters by tenant
  const existing = await tx
    .select({ purchaseNo: purchases.purchaseNo })
    .from(purchases)
    .where(ilike(purchases.purchaseNo, `${prefix}%`))
    .orderBy(desc(purchases.purchaseNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].purchaseNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

// GET all purchases for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, purchasesListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, status, supplierId: filterSupplierId, warehouseId: filterWarehouseId, sortBy, sortOrder: sortOrderParam } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(purchases.purchaseNo, `%${escaped}%`),
            ilike(suppliers.name, `%${escaped}%`)
          )!
        )
      }

      if (status) {
        conditions.push(eq(purchases.status, status))
      }

      if (filterSupplierId) {
        conditions.push(eq(purchases.supplierId, filterSupplierId))
      }

      if (filterWarehouseId) {
        conditions.push(eq(purchases.warehouseId, filterWarehouseId))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Build sort order
      const sortFn = sortOrderParam === 'asc' ? asc : desc
      const sortFieldMap: Record<string, typeof purchases.createdAt | typeof purchases.purchaseNo | typeof purchases.status | typeof purchases.total | typeof suppliers.name> = {
        createdAt: purchases.createdAt,
        purchaseNo: purchases.purchaseNo,
        status: purchases.status,
        total: purchases.total,
        supplierName: suppliers.name,
      }
      const orderByField = sortFieldMap[sortBy] || purchases.createdAt
      const orderByClause = sortFn(orderByField)

    // Return all purchases (for dropdowns)
    if (all) {
      const data = await db
        .select({
          id: purchases.id,
          purchaseNo: purchases.purchaseNo,
          purchaseOrderId: purchases.purchaseOrderId,
          supplierId: purchases.supplierId,
          supplierName: suppliers.name,
          warehouseId: purchases.warehouseId,
          warehouseName: warehouses.name,
          supplierInvoiceNo: purchases.supplierInvoiceNo,
          supplierBillDate: purchases.supplierBillDate,
          paymentTerm: purchases.paymentTerm,
          subtotal: purchases.subtotal,
          taxAmount: purchases.taxAmount,
          total: purchases.total,
          paidAmount: purchases.paidAmount,
          status: purchases.status,
          notes: purchases.notes,
          isReturn: purchases.isReturn,
          createdBy: purchases.createdBy,
          createdByName: users.fullName,
          cancellationReason: purchases.cancellationReason,
          cancelledAt: purchases.cancelledAt,
          createdAt: purchases.createdAt,
          updatedAt: purchases.updatedAt,
        })
        .from(purchases)
        .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
        .leftJoin(warehouses, eq(purchases.warehouseId, warehouses.id))
        .leftJoin(users, eq(purchases.createdBy, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(1000)

      return { data, isAll: true }
      }

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(purchases)
      .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .where(whereClause)

    const total = Number(count)
    const totalPages = Math.ceil(total / pageSize)
    const offset = (page - 1) * pageSize

    // Get paginated results
    const data = await db
      .select({
        id: purchases.id,
        purchaseNo: purchases.purchaseNo,
        purchaseOrderId: purchases.purchaseOrderId,
        purchaseOrderNo: purchaseOrders.orderNo,
        supplierId: purchases.supplierId,
        supplierName: suppliers.name,
        warehouseId: purchases.warehouseId,
        warehouseName: warehouses.name,
        supplierInvoiceNo: purchases.supplierInvoiceNo,
        supplierBillDate: purchases.supplierBillDate,
        paymentTerm: purchases.paymentTerm,
        subtotal: purchases.subtotal,
        taxAmount: purchases.taxAmount,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
        status: purchases.status,
        notes: purchases.notes,
        isReturn: purchases.isReturn,
        createdBy: purchases.createdBy,
        createdByName: users.fullName,
        cancellationReason: purchases.cancellationReason,
        cancelledAt: purchases.cancelledAt,
        createdAt: purchases.createdAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .leftJoin(warehouses, eq(purchases.warehouseId, warehouses.id))
      .leftJoin(users, eq(purchases.createdBy, users.id))
      .leftJoin(purchaseOrders, eq(purchases.purchaseOrderId, purchaseOrders.id))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(pageSize)
      .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Return array directly for 'all' mode, or paginated response
    if ('isAll' in result && result.isAll) {
      return NextResponse.json(result.data)
    }
    return NextResponse.json({ data: result.data, pagination: result.pagination })
  } catch (error) {
    logError('api/purchases', error)
    return NextResponse.json(
      { error: 'Failed to fetch purchases' },
      { status: 500 }
    )
  }
}

// POST create new purchase invoice
export async function POST(request: NextRequest) {
  // Auth check FIRST before body parsing
  const preSession = await authWithCompany()
  if (!preSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quotaError = await requireQuota(preSession.user.tenantId, 'standard')
  if (quotaError) return quotaError

  const parsed = await validateBody(request, createPurchaseSchema)
  if (!parsed.success) return parsed.response
  const { supplierId, warehouseId, purchaseOrderId, supplierInvoiceNo, supplierBillDate, paymentTerm, notes, costCenterId, items } = parsed.data

  // Calculate totals from items
  let subtotal = 0
  let taxAmount = 0

  if (items && items.length > 0) {
    items.forEach((item) => {
      const itemTotal = item.quantity * item.unitPrice
      const itemTax = Math.max(0, item.tax || 0)
      subtotal += itemTotal
      taxAmount += itemTax
    })
  }

  subtotal = Math.round(subtotal * 100) / 100
  taxAmount = Math.round(taxAmount * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100
  const effectivePaymentTerm = paymentTerm || 'cash'

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      // Issue #94: Verify permission to manage purchases
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

      // Generate purchase number with lock
      const purchaseNo = await generatePurchaseNo(tx)

      // Create purchase invoice
      const [newPurchase] = await tx.insert(purchases).values({
        tenantId: session.user.tenantId,
        purchaseNo,
        purchaseOrderId: purchaseOrderId || null,
        supplierId,
        warehouseId,
        supplierInvoiceNo: supplierInvoiceNo || null,
        supplierBillDate: supplierBillDate || null,
        paymentTerm: effectivePaymentTerm,
        subtotal: subtotal.toString(),
        taxAmount: taxAmount.toString(),
        total: total.toString(),
        paidAmount: '0',
        status: 'draft',
        notes: notes || null,
        costCenterId: costCenterId || null,
        createdBy: session.user.id,
      }).returning()

      // Note: Supplier balance is NOT updated on draft creation.
      // It will be updated when the purchase is submitted (draft → pending).

      // Add items if provided
      if (items && items.length > 0) {
        const purchaseItemsData = items.map((item) => {
          const itemTotal = item.quantity * item.unitPrice
          const itemTax = Math.max(0, item.tax || 0)

          return {
            tenantId: session.user.tenantId,
            purchaseId: newPurchase.id,
            itemId: item.itemId || null,
            itemName: item.itemName,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            tax: itemTax.toString(),
            total: (Math.round((itemTotal + itemTax) * 100) / 100).toString(),
          }
        })

        await tx.insert(purchaseItems).values(purchaseItemsData)

        // Dual mode: try template-based tax recalculation
        const lineItems = items.map(item => ({
          itemId: item.itemId || null,
          lineTotal: item.quantity * item.unitPrice,
        }))
        const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })

        if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
          // Template configured — use computed values
          await tx.update(purchases)
            .set({
              subtotal: taxResult.subtotal.toString(),
              taxAmount: taxResult.totalTax.toString(),
              taxBreakdown: taxResult.taxBreakdown,
              total: taxResult.total.toString(),
            })
            .where(eq(purchases.id, newPurchase.id))
        }
      }

      return { data: newPurchase, tenantId: session.user.tenantId }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    // Broadcast the changes to connected clients
    logAndBroadcast(result.tenantId, 'purchase', 'created', result.data.id)

    // Integrity audit (fire-and-forget)
    auditPurchaseIntegrity(result.data.id, result.tenantId)

    // AI: Purchase anomaly detection (fire-and-forget)
    if (items && items.length > 0) {
      checkPurchaseAnomalies(result.tenantId, {
        id: result.data.id,
        purchaseNo: result.data.purchaseNo,
        total,
        items: items.map(item => ({
          itemName: item.itemName,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    logError('api/purchases', error)
    return NextResponse.json(
      { error: 'Failed to create purchase invoice' },
      { status: 500 }
    )
  }
}
