import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getInventoryValuationReconciliation } from '@/lib/reports/inventory'
import { requireAllBranches } from '@/lib/auth/branch-access'

// GET /api/reports/inventory-valuation-reconciliation — H3: stock value (weighted average) per
// warehouse vs the stock account balance in the GL
export async function GET() {
  const session = await authWithCompany()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permError = requirePermission(session, 'viewReports')
  if (permError) {
    const acctError = requirePermission(session, 'viewAccounting')
    if (acctError) return permError
  }
  // K4: compared with the company-wide GL: refused for branch-restricted users
  const branchError = await requireAllBranches(session)
  if (branchError) return branchError
  const result = await withTenant(session.user.tenantId, (db) => getInventoryValuationReconciliation(db, session.user.tenantId))
  return NextResponse.json(result)
}
