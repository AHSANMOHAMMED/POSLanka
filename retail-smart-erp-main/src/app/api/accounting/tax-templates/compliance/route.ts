import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { tenants } from '@/lib/db/schema'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { fixTaxCompliance, getTaxComplianceIssues, seedCountryTaxTemplates } from '@/lib/setup/seed-tax-templates'

// GET /api/accounting/tax-templates/compliance — country tax-rule warnings (Sri Lanka: VAT 18%, NBT abolished)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError
    return await withTenant(session.user.tenantId, async (db) =>
      NextResponse.json(await getTaxComplianceIssues(db, session.user.tenantId)))
  } catch (error) {
    logError('api/accounting/tax-templates/compliance', error)
    return NextResponse.json({ error: 'Failed to check tax templates' }, { status: 500 })
  }
}

const actionSchema = z.object({
  /** fix = apply the one-click fix; seed = add the country's templates that are missing */
  action: z.enum(['fix', 'seed']),
  includeOptional: z.boolean().optional(),
})

// POST /api/accounting/tax-templates/compliance — explicit, user-triggered fix / seeding
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError
    const parsed = await validateBody(request, actionSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId

    return await withTenantTransaction(tenantId, async (tx) => {
      if (parsed.data.action === 'seed') {
        const [tenant] = await tx.select({ country: tenants.country }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
        const result = await seedCountryTaxTemplates(tx, tenantId, tenant?.country || 'LK', { includeOptional: parsed.data.includeOptional })
        if (result.created.length) logAndBroadcast(tenantId, 'tax-template', 'created', result.defaultTemplateId || 'seed')
        return NextResponse.json(result)
      }
      const result = await fixTaxCompliance(tx, tenantId)
      logAndBroadcast(tenantId, 'tax-template', 'updated', 'compliance-fix')
      const after = await getTaxComplianceIssues(tx, tenantId)
      return NextResponse.json({ ...result, issues: after.issues })
    })
  } catch (error) {
    logError('api/accounting/tax-templates/compliance', error)
    return NextResponse.json({ error: 'Failed to update tax templates' }, { status: 500 })
  }
}
