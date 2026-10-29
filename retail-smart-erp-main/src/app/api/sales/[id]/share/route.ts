import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { sales } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertBranchAccess } from '@/lib/auth/branch-access'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { appBaseUrl, billUrl } from '@/lib/messaging/bill-link'
import { logError } from '@/lib/ai/error-logger'

/**
 * GET /api/sales/[id]/share — what the "WhatsApp" / "Share PDF" buttons need: the signed bill page and
 * PDF links plus the customer's phone (from the customer record, so the cashier never types it).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    return await withTenant(session.user.tenantId, async (db) => {
      const sale = await db.query.sales.findFirst({
        where: eq(sales.id, p.data.id),
        columns: { id: true, invoiceNo: true, total: true, customerName: true, isReturn: true, warehouseId: true, createdAt: true },
        with: { customer: { columns: { name: true, phone: true, mobilePhone: true } } },
      })
      if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      const denied = await assertBranchAccess(session, sale.warehouseId, db)
      if (denied) return denied
      const base = appBaseUrl(request.nextUrl.origin)
      const page = billUrl(sale.id, base)
      return NextResponse.json({
        invoiceNo: sale.invoiceNo,
        total: sale.total,
        isReturn: sale.isReturn,
        createdAt: sale.createdAt,
        customerName: sale.customer?.name || sale.customerName || null,
        phone: sale.customer?.mobilePhone || sale.customer?.phone || null,
        pageUrl: page,
        pdfUrl: `${page}/pdf`,
      })
    })
  } catch (error) {
    logError('api/sales/[id]/share', error)
    return NextResponse.json({ error: 'Failed to prepare the bill link' }, { status: 500 })
  }
}
