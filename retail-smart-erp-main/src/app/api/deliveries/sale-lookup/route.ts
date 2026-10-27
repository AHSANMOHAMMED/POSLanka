import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getBranchScope } from '@/lib/auth/branch-access'
import { logError } from '@/lib/ai/error-logger'
import { findSaleByInvoice, loadSales } from '@/lib/installments/sale-lookup'
import { activePlanForSale } from '@/lib/installments/service'
import { DELIVERY_EDIT, requireAny } from '@/lib/installments/access'

/**
 * GET /api/deliveries/sale-lookup?invoiceNo=INV-… | ?saleId=… — the sale to deliver (and its
 * hire purchase plan, if any): customer, address, goods with serial / IMEI numbers. Branch-
 * restricted staff only find their own branches' sales.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const denied = requireAny(session, DELIVERY_EDIT)
    if (denied) return denied
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const invoiceNo = request.nextUrl.searchParams.get('invoiceNo')?.trim()
    const saleId = request.nextUrl.searchParams.get('saleId')?.trim()
    if (!invoiceNo && !saleId) return NextResponse.json({ error: 'Enter an invoice number' }, { status: 400 })
    if (saleId && !/^[0-9a-f-]{36}$/i.test(saleId)) return NextResponse.json({ error: 'Invalid sale id' }, { status: 400 })

    return await withTenant(session.user.tenantId, async (db) => {
      const scope = await getBranchScope(session, db)
      let sale = invoiceNo ? await findSaleByInvoice(db, invoiceNo, scope) : (await loadSales(db, [saleId!]))[0] ?? null
      if (sale && scope && (!sale.warehouseId || !scope.includes(sale.warehouseId))) sale = null
      if (!sale) return NextResponse.json({ error: 'No sale found with that invoice number' }, { status: 404 })
      const existingPlan = await activePlanForSale(db, sale.id)
      return NextResponse.json({ sale, existingPlan })
    })
  } catch (error) {
    logError('api/deliveries/sale-lookup', error)
    return NextResponse.json({ error: 'Failed to look up the sale' }, { status: 500 })
  }
}
