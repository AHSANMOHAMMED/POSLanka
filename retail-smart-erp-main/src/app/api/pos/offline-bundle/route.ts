import { NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { logError } from '@/lib/ai/error-logger'
import { buildOfflineBundle, canSyncCatalog } from '@/lib/inventory/item-sync'

// GET /api/pos/offline-bundle — what a POS device needs to keep selling offline (W6):
// { taxTemplates, accountingSettings: { defaultTaxTemplateId }, scaleBarcode, shift, posProfile, categories, serverTime }
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canSyncCatalog(session)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    const userId = await resolveUserIdRequired(session)
    const bundle = await withTenant(session.user.tenantId, (db) => buildOfflineBundle(db, {
      tenantId: session.user.tenantId,
      userId,
    }))
    return NextResponse.json(bundle)
  } catch (error) {
    logError('api/pos/offline-bundle', error)
    return NextResponse.json({ error: 'Failed to build offline bundle' }, { status: 500 })
  }
}
