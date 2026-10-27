import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { customers, itemSerialNumbers, items as itemsTable, saleItems, sales, users, warehouses, warrantyClaims } from '@/lib/db/schema'
import { assertBranchAccess, branchFilter, getBranchScope } from '@/lib/auth/branch-access'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { createWarrantyClaimSchema, warrantyClaimsListSchema } from '@/lib/validation/schemas/installments'
import { escapeLikePattern } from '@/lib/utils/sql'
import { nextDocNo } from '@/lib/documents/numbering'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { toApiError } from '@/lib/db/errors'
import { tenantToday } from '@/lib/accounting/gl'
import { InstallmentError } from '@/lib/installments/service'
import { WARRANTY_EDIT, WARRANTY_VIEW, requireAny } from '@/lib/installments/access'

/** GET /api/warranty-claims — claims / service tickets (status, open = not delivered or rejected, search) */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, WARRANTY_VIEW)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, warrantyClaimsListSchema)
    if (!parsed.success) return parsed.response
    const { status, search, page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      const conds: SQL[] = []
      const branchCond = branchFilter(scope, warrantyClaims.warehouseId)
      if (branchCond) conds.push(branchCond)
      if (status === 'open') conds.push(sql`${warrantyClaims.status} NOT IN ('delivered', 'rejected')`)
      else if (status && status !== 'all') conds.push(eq(warrantyClaims.status, status))
      if (search) {
        const like = `%${escapeLikePattern(search)}%`
        const digits = search.replace(/\D/g, '')
        const ors: SQL[] = [
          ilike(warrantyClaims.claimNo, like), ilike(warrantyClaims.serialNumber, like), ilike(warrantyClaims.itemName, like),
          ilike(warrantyClaims.customerName, like),
          sql`EXISTS (SELECT 1 FROM sales s WHERE s.id = ${warrantyClaims.saleId} AND s.invoice_no ILIKE ${like})`,
        ]
        if (digits.length >= 6) ors.push(sql`regexp_replace(coalesce(${warrantyClaims.customerPhone}, ''), '\\D', '', 'g') LIKE ${'%' + digits.slice(-9) + '%'}`)
        conds.push(or(...ors)!)
      }
      const where = conds.length ? and(...conds) : undefined
      const [rows, [{ n }], counts] = await Promise.all([
        db.select({
          id: warrantyClaims.id, claimNo: warrantyClaims.claimNo, status: warrantyClaims.status,
          itemName: warrantyClaims.itemName, serialNumber: warrantyClaims.serialNumber,
          customerName: warrantyClaims.customerName, customerPhone: warrantyClaims.customerPhone,
          inWarranty: warrantyClaims.inWarranty, warrantyUntil: warrantyClaims.warrantyUntil,
          complaint: warrantyClaims.complaint, technicianName: users.fullName, expectedDate: warrantyClaims.expectedDate,
          estimatedCharge: warrantyClaims.estimatedCharge, finalCharge: warrantyClaims.finalCharge,
          resolution: warrantyClaims.resolution, invoiceNo: sales.invoiceNo, warehouseName: warehouses.name,
          createdAt: warrantyClaims.createdAt,
        })
          .from(warrantyClaims)
          .leftJoin(users, eq(users.id, warrantyClaims.technicianId))
          .leftJoin(sales, eq(sales.id, warrantyClaims.saleId))
          .leftJoin(warehouses, eq(warehouses.id, warrantyClaims.warehouseId))
          .where(where)
          .orderBy(desc(warrantyClaims.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: sql<number>`count(*)::int` }).from(warrantyClaims).where(where),
        db.select({ status: warrantyClaims.status, count: sql<number>`count(*)::int` }).from(warrantyClaims).where(branchCond).groupBy(warrantyClaims.status),
      ])
      return NextResponse.json({
        data: rows,
        counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
        pagination: { page, pageSize, total: n, totalPages: Math.ceil(n / pageSize) },
      })
    })
  } catch (error) {
    logError('api/warranty-claims GET', error)
    return NextResponse.json({ error: 'Failed to load warranty claims' }, { status: 500 })
  }
}

/**
 * POST /api/warranty-claims — receive a unit for warranty / repair. Warranty dates are re-read
 * from the sale line and the serial number when given (the unit's own end date wins), so the
 * in / out of warranty flag cannot be set by hand.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, WARRANTY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, createWarrantyClaimSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const quotaError = await requireQuota(tenantId, 'standard')
    if (quotaError) return quotaError
    const userId = await resolveUserIdRequired(session)
    const today = await tenantToday(tenantId)

    const result = await withTenantTransaction(tenantId, async (tx) => {
      const scope = await getBranchScope(session, tx)
      let warehouseId = body.warehouseId || null
      let customerId = body.customerId || null
      let purchaseDate = body.purchaseDate || null
      let warrantyUntil = body.warrantyUntil || null
      let itemId = body.itemId || null
      let serialNumber = body.serialNumber || null
      let saleItemId = body.saleItemId || null

      if (body.saleId) {
        const [sale] = await tx.select({
          id: sales.id, warehouseId: sales.warehouseId, customerId: sales.customerId,
          saleDate: sql<string>`(${sales.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo')::date::text`,
        }).from(sales).where(eq(sales.id, body.saleId))
        if (!sale) throw new InstallmentError('Sale not found', 404)
        warehouseId = sale.warehouseId
        customerId = sale.customerId || customerId
        purchaseDate = sale.saleDate
        warrantyUntil = null
        if (saleItemId) {
          const [line] = await tx.select({ id: saleItems.id, itemId: saleItems.itemId, warrantyUntil: saleItems.warrantyUntil })
            .from(saleItems).where(and(eq(saleItems.id, saleItemId), eq(saleItems.saleId, sale.id)))
          if (!line) saleItemId = null
          else {
            itemId = line.itemId ?? itemId
            warrantyUntil = line.warrantyUntil ? String(line.warrantyUntil) : null
          }
        }
      } else {
        saleItemId = null
      }
      if (body.serialNumberId) {
        const [sn] = await tx.select({ id: itemSerialNumbers.id, serialNumber: itemSerialNumbers.serialNumber, itemId: itemSerialNumbers.itemId, end: itemSerialNumbers.warrantyEndDate })
          .from(itemSerialNumbers).where(eq(itemSerialNumbers.id, body.serialNumberId))
        if (!sn) throw new InstallmentError('Serial number not found', 404)
        serialNumber = sn.serialNumber
        itemId = sn.itemId
        if (sn.end) warrantyUntil = String(sn.end)
      }
      const branchDenied = await assertBranchAccess(session, warehouseId, tx, { scope, requireBranch: !!scope })
      if (branchDenied) return { response: branchDenied }
      if (!warehouseId && scope) warehouseId = scope[0]
      if (itemId) {
        const [it] = await tx.select({ id: itemsTable.id }).from(itemsTable).where(eq(itemsTable.id, itemId))
        if (!it) itemId = null
      }
      if (customerId) {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))
        if (!c) customerId = null
      }
      if (body.technicianId) {
        const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, body.technicianId))
        if (!u) throw new InstallmentError('Technician not found')
      }
      const inWarranty = !!warrantyUntil && warrantyUntil >= today

      const claimNo = await nextDocNo(tx, tenantId, 'warranty_claim')
      const [row] = await tx.insert(warrantyClaims).values({
        tenantId,
        claimNo,
        warehouseId,
        saleId: body.saleId || null,
        saleItemId,
        itemId,
        serialNumberId: body.serialNumberId || null,
        serialNumber,
        itemName: body.itemName,
        customerId,
        customerName: body.customerName,
        customerPhone: body.customerPhone || null,
        purchaseDate,
        warrantyUntil,
        inWarranty,
        complaint: body.complaint,
        accessories: body.accessories || null,
        conditionNotes: body.conditionNotes || null,
        technicianId: body.technicianId || null,
        status: 'received',
        estimatedCharge: String(inWarranty ? 0 : body.estimatedCharge),
        expectedDate: body.expectedDate || null,
        history: [{ status: 'received', at: new Date().toISOString(), by: session.user.name || null, note: null }],
        notes: body.notes || null,
        createdBy: userId,
      }).returning()
      return { row }
    })
    if ('response' in result) return result.response
    logAndBroadcast(tenantId, 'warranty-claim', 'created', result.row.id, {
      userId: session.user.id,
      entityName: result.row.claimNo,
      description: `Received ${result.row.itemName}${result.row.serialNumber ? ` (${result.row.serialNumber})` : ''} for ${result.row.inWarranty ? 'warranty' : 'repair'}: ${result.row.claimNo}`,
    })
    return NextResponse.json(result.row, { status: 201 })
  } catch (error) {
    if (error instanceof InstallmentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    const apiError = toApiError(error)
    if (apiError) return apiError
    logError('api/warranty-claims POST', error)
    return NextResponse.json({ error: 'Failed to create warranty claim' }, { status: 500 })
  }
}
