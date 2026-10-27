import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { customers, deliveries, installmentPlans, sales, users, warehouses } from '@/lib/db/schema'
import { assertBranchAccess, branchFilter, getBranchScope } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createDeliverySchema, deliveriesListSchema } from '@/lib/validation/schemas/installments'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { InstallmentError } from '@/lib/installments/service'
import { DELIVERY_EDIT, DELIVERY_VIEW, requireAny } from '@/lib/installments/access'

/**
 * GET /api/deliveries?date=YYYY-MM-DD (day view, default today) | fromDate&toDate | saleId,
 * status (open = scheduled / out for delivery), search (no., customer, phone, address, vehicle).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, DELIVERY_VIEW)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, deliveriesListSchema)
    if (!parsed.success) return parsed.response
    const { date, fromDate, toDate, status, saleId, search, page, pageSize } = parsed.data
    const today = await tenantToday(session.user.tenantId)

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const conds: SQL[] = []
      const branchCond = branchFilter(scope, deliveries.warehouseId)
      if (branchCond) conds.push(branchCond)
      if (saleId) conds.push(eq(deliveries.saleId, saleId))
      else if (fromDate || toDate) {
        if (fromDate) conds.push(gte(deliveries.scheduledDate, fromDate))
        if (toDate) conds.push(lte(deliveries.scheduledDate, toDate))
      } else if (!search) {
        conds.push(eq(deliveries.scheduledDate, date || today))
      }
      if (status === 'open') conds.push(sql`${deliveries.status} IN ('scheduled', 'out_for_delivery')`)
      else if (status && status !== 'all') conds.push(eq(deliveries.status, status))
      if (search) {
        const like = `%${escapeLikePattern(search)}%`
        conds.push(or(
          ilike(deliveries.deliveryNo, like), ilike(deliveries.customerName, like), ilike(deliveries.customerPhone, like),
          ilike(deliveries.address, like), ilike(deliveries.vehicleNo, like), ilike(deliveries.city, like),
          sql`EXISTS (SELECT 1 FROM sales s WHERE s.id = ${deliveries.saleId} AND s.invoice_no ILIKE ${like})`,
        )!)
      }
      const where = conds.length ? and(...conds) : undefined
      const [rows, [{ n }]] = await Promise.all([
        db.select({
          id: deliveries.id, deliveryNo: deliveries.deliveryNo, saleId: deliveries.saleId, invoiceNo: sales.invoiceNo,
          installmentPlanId: deliveries.installmentPlanId, planNo: installmentPlans.planNo,
          customerName: deliveries.customerName, customerPhone: deliveries.customerPhone,
          address: deliveries.address, city: deliveries.city, scheduledDate: deliveries.scheduledDate, timeSlot: deliveries.timeSlot,
          vehicleNo: deliveries.vehicleNo, driverId: deliveries.driverId, driverName: deliveries.driverName,
          installationRequired: deliveries.installationRequired, technicianId: deliveries.technicianId, technicianName: deliveries.technicianName,
          items: deliveries.items, deliveryCharge: deliveries.deliveryCharge, status: deliveries.status,
          dispatchedAt: deliveries.dispatchedAt, deliveredAt: deliveries.deliveredAt, installedAt: deliveries.installedAt,
          recipientName: deliveries.recipientName, recipientPhone: deliveries.recipientPhone, proofNotes: deliveries.proofNotes,
          proofPhotoUrl: deliveries.proofPhotoUrl, failureReason: deliveries.failureReason, notes: deliveries.notes,
          warehouseId: deliveries.warehouseId, warehouseName: warehouses.name, createdAt: deliveries.createdAt,
        })
          .from(deliveries)
          .leftJoin(sales, eq(sales.id, deliveries.saleId))
          .leftJoin(installmentPlans, eq(installmentPlans.id, deliveries.installmentPlanId))
          .leftJoin(warehouses, eq(warehouses.id, deliveries.warehouseId))
          .where(where)
          .orderBy(asc(deliveries.scheduledDate), sql`${deliveries.timeSlot} NULLS LAST`, asc(deliveries.deliveryNo))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(where),
      ])
      return NextResponse.json({ data: rows, today, pagination: { page, pageSize, total: n, totalPages: Math.ceil(n / pageSize) } })
    })
  } catch (error) {
    logError('api/deliveries GET', error)
    return NextResponse.json({ error: 'Failed to load deliveries' }, { status: 500 })
  }
}

/** POST /api/deliveries — schedule a delivery (and installation) for a sale or a hire purchase plan. */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, DELIVERY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, createDeliverySchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError
    const userId = await resolveUserIdRequired(session)

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const scope = await getBranchScope(session, tx)
      let warehouseId = body.warehouseId || null
      let customerId = body.customerId || null
      let saleId = body.saleId || null
      if (body.installmentPlanId) {
        const [plan] = await tx.select({ id: installmentPlans.id, saleId: installmentPlans.saleId, warehouseId: installmentPlans.warehouseId, customerId: installmentPlans.customerId })
          .from(installmentPlans).where(eq(installmentPlans.id, body.installmentPlanId))
        if (!plan) throw new InstallmentError('Installment plan not found', 404)
        warehouseId = plan.warehouseId ?? warehouseId
        customerId = plan.customerId ?? customerId
        saleId = saleId || plan.saleId
      }
      if (saleId) {
        const [sale] = await tx.select({ id: sales.id, warehouseId: sales.warehouseId, customerId: sales.customerId, status: sales.status })
          .from(sales).where(eq(sales.id, saleId))
        if (!sale) throw new InstallmentError('Sale not found', 404)
        if (sale.status === 'void') throw new InstallmentError('This sale is void')
        warehouseId = sale.warehouseId
        customerId = sale.customerId || customerId
      }
      const branchDenied = await assertBranchAccess(session, warehouseId, tx, { scope, requireBranch: !!scope })
      if (branchDenied) return { response: branchDenied }
      if (!warehouseId && scope) warehouseId = scope[0]
      if (customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))
        if (!c) customerId = null
      }
      // driver / technician names from the staff record when picked from the list
      const staffIds = [body.driverId, body.technicianId].filter((x): x is string => !!x)
      const staff = staffIds.length
        ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(sql`${users.id} IN (${sql.join(staffIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
        : []
      const nameOf = (id: string | null | undefined) => staff.find((s) => s.id === id)?.fullName ?? null
      if (body.driverId && !nameOf(body.driverId)) throw new InstallmentError('Driver not found')
      if (body.technicianId && !nameOf(body.technicianId)) throw new InstallmentError('Technician not found')

      const deliveryNo = await nextDocNo(tx, tenantId, 'delivery')
      const [row] = await tx.insert(deliveries).values({
        tenantId,
        deliveryNo,
        saleId,
        installmentPlanId: body.installmentPlanId || null,
        warehouseId,
        customerId,
        customerName: body.customerName,
        customerPhone: body.customerPhone || null,
        address: body.address,
        city: body.city || null,
        scheduledDate: body.scheduledDate,
        timeSlot: body.timeSlot || null,
        vehicleNo: body.vehicleNo ? body.vehicleNo.toUpperCase() : null,
        driverId: body.driverId || null,
        driverName: nameOf(body.driverId) || body.driverName || null,
        installationRequired: body.installationRequired,
        technicianId: body.installationRequired ? body.technicianId || null : null,
        technicianName: body.installationRequired ? nameOf(body.technicianId) || body.technicianName || null : null,
        items: body.items.map((i) => ({
          itemId: i.itemId || null, saleItemId: i.saleItemId || null, itemName: i.itemName,
          quantity: i.quantity, unitPrice: i.unitPrice, serialNumbers: i.serialNumbers || [],
        })),
        deliveryCharge: String(body.deliveryCharge),
        notes: body.notes || null,
        createdBy: userId,
      }).returning()
      return { row }
    })
    if ('response' in result) return result.response
    logAndBroadcast(tenantId, 'delivery', 'created', result.row.id, {
      userId: session.user.id,
      entityName: result.row.deliveryNo,
      description: `Scheduled delivery ${result.row.deliveryNo} to ${result.row.customerName} on ${result.row.scheduledDate}`,
    })
    return NextResponse.json(result.row, { status: 201 })
  } catch (error) {
    if (error instanceof InstallmentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/deliveries POST', error)
    return NextResponse.json({ error: 'Failed to schedule delivery' }, { status: 500 })
  }
}
