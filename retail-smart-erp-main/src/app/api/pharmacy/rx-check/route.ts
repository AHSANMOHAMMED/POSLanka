import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { prescriptionRequirement } from '@/lib/pharmacy/prescriptions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/pharmacy/rx-check?ids=<itemId,…> — does this cart need a prescription?
 * → { level: 'none' | 'prescription' | 'controlled', items: [{ id, name, drugSchedule, genericName }] }
 * The POS (web and app) asks before taking payment; POST /api/sales applies the same rule.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError
    const ids = (request.nextUrl.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)).slice(0, 200)
    const result = await withTenant(session.user.tenantId, (db) => prescriptionRequirement(db, session.user.tenantId, ids))
    return NextResponse.json(result)
  } catch (error) {
    logError('api/pharmacy/rx-check', error)
    return NextResponse.json({ error: 'Failed to check prescriptions' }, { status: 500 })
  }
}
