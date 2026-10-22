import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { canSyncCatalog } from '@/lib/inventory/item-sync'
import { loadPricingBundle } from '@/lib/pricing/load-context'
import { logError } from '@/lib/ai/error-logger'

// GET /api/price-quote/bundle — price lists, promotions, units, unit conversions and extra barcodes
// for offline POS devices (also embedded as `pricing` in GET /api/pos/offline-bundle). The device
// runs the same engine (apps/mobile/src/lib/pricingEngine.ts); the server re-prices on sync.
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canSyncCatalog(session)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    const tenantId = session.user.tenantId
    return NextResponse.json(await withTenant(tenantId, (db) => loadPricingBundle(db, tenantId)))
  } catch (error) {
    logError('api/price-quote/bundle', error)
    return NextResponse.json({ error: 'Failed to build pricing bundle' }, { status: 500 })
  }
}
