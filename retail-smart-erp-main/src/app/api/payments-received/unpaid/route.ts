import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { getBranchScope } from '@/lib/auth/branch-access'
import { validateSearchParams } from '@/lib/validation/helpers'
import { unpaidInvoicesSchema } from '@/lib/validation/schemas/payments-received'
import { logError } from '@/lib/ai/error-logger'
import { roundCurrency } from '@/lib/utils/currency'
import { unpaidInvoices } from '@/lib/payments-received/server'

// GET /api/payments-received/unpaid?customerId= — the customer's open invoices (oldest first),
// their total outstanding and the store credit available to apply
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError
    const parsed = validateSearchParams(request, unpaidInvoicesSchema)
    if (!parsed.success) return parsed.response
    const { customerId } = parsed.data
    return await withTenant(session.user.tenantId, async (db) => {
      const [customer] = await db.select({ id: customers.id, name: customers.name, balance: customers.balance }).from(customers).where(eq(customers.id, customerId))
      if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      const scope = await getBranchScope(session, db)
      const invoices = await unpaidInvoices(db, customerId, scope)
      return NextResponse.json({
        customer: { id: customer.id, name: customer.name, creditBalance: Number(customer.balance) || 0 },
        invoices,
        outstanding: roundCurrency(invoices.reduce((s, i) => s + i.balance, 0)),
      })
    })
  } catch (error) {
    logError('api/payments-received/unpaid', error)
    return NextResponse.json({ error: 'Failed to fetch unpaid invoices' }, { status: 500 })
  }
}
