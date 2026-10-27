import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { recurringPreviewSchema } from '@/lib/validation/schemas/recurring-invoices'
import { logError } from '@/lib/ai/error-logger'
import { priceInvoiceLines } from '@/lib/billing/sales-invoice'
import { PricingLineError } from '@/lib/pricing/load-context'

// POST /api/recurring-invoices/preview — totals an invoice from these lines would have today
// (same pricing / promotions / tax templates as POST /api/sales)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = await validateBody(request, recurringPreviewSchema)
    if (!parsed.success) return parsed.response
    const { customerId, lines } = parsed.data
    const priced = await withTenant(session.user.tenantId, (db) => priceInvoiceLines(db, session.user.tenantId, {
      customerId: customerId || null,
      lines: lines.map((l) => ({ itemId: l.itemId, name: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, uom: l.uom })),
    }))
    return NextResponse.json({ subtotal: priced.subtotal, promotionDiscount: priced.promotionDiscount, tax: priced.tax, total: priced.total, lines: priced.lines })
  } catch (error) {
    if (error instanceof PricingLineError) return NextResponse.json({ error: 'Invalid item or unit on a line', code: error.code }, { status: 400 })
    logError('api/recurring-invoices/preview', error)
    return NextResponse.json({ error: 'Failed to price the invoice' }, { status: 500 })
  }
}
