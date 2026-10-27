import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers, paymentReceiptAllocations, paymentReceipts, sales, users, warehouses } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { logError } from '@/lib/ai/error-logger'

// GET /api/payments-received/[id] — a payment receipt (printable) with its invoice allocations
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data
    return await withTenant(session.user.tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, paymentReceipts, id, { includeUnassigned: true })
      if (denied) return denied
      const [row] = await db.select({
        receipt: paymentReceipts, customerName: customers.name, customerPhone: customers.phone, customerAddress: customers.address,
        customerCredit: customers.balance, receivedBy: users.fullName, warehouseName: warehouses.name,
      }).from(paymentReceipts)
        .leftJoin(customers, eq(customers.id, paymentReceipts.customerId))
        .leftJoin(users, eq(users.id, paymentReceipts.createdBy))
        .leftJoin(warehouses, eq(warehouses.id, paymentReceipts.warehouseId))
        .where(eq(paymentReceipts.id, id))
      if (!row) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
      const allocations = await db.select({
        id: paymentReceiptAllocations.id, saleId: paymentReceiptAllocations.saleId, invoiceNo: paymentReceiptAllocations.invoiceNo,
        amount: paymentReceiptAllocations.amount, creditAmount: paymentReceiptAllocations.creditAmount,
        invoiceTotal: sales.total, invoicePaid: sales.paidAmount, invoiceDate: sales.createdAt, invoiceStatus: sales.status,
      }).from(paymentReceiptAllocations)
        .leftJoin(sales, eq(sales.id, paymentReceiptAllocations.saleId))
        .where(eq(paymentReceiptAllocations.receiptId, id))
        .orderBy(asc(paymentReceiptAllocations.createdAt))
      return NextResponse.json({
        ...row.receipt, customerName: row.customerName, customerPhone: row.customerPhone, customerAddress: row.customerAddress,
        customerCredit: row.customerCredit, receivedBy: row.receivedBy, warehouseName: row.warehouseName, allocations,
      })
    })
  } catch (error) {
    logError('api/payments-received/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch the receipt' }, { status: 500 })
  }
}
