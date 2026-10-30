import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withTenant } from '@/lib/db'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { rangeSince } from '@/app/api/sys-control/analytics/_shared'
import { vendorQuickFigures } from '@/lib/admin/vendor-business'

const idsSchema = z.array(z.string().uuid()).min(1).max(50)
/** Vendors read at once, so one busy list page cannot take the whole connection pool */
const CONCURRENCY = 4

type Figures = Awaited<ReturnType<typeof vendorQuickFigures>>

/**
 * GET /api/sys-control/vendors/figures?ids=a,b,c — stock at cost, and sales and gross profit of the
 * last 30 days, for the vendors on one list page. vendors.impersonate, like their reports.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('vendors.impersonate')
    if (!session) return adminAuthError()
    const ids = idsSchema.safeParse((request.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean))
    if (!ids.success) return NextResponse.json({ error: 'Give 1 to 50 vendor ids' }, { status: 400 })

    const since = rangeSince('30d')
    const figures: Record<string, Figures> = {}
    const queue = [...ids.data]
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const vendorId = id
        figures[vendorId] = await withTenant(vendorId, (tx) => vendorQuickFigures(tx, vendorId, since))
      }
    }))
    return NextResponse.json({ figures })
  } catch (error) {
    logError('api/sys-control/vendors/figures', error)
    return NextResponse.json({ error: 'Failed to load the figures' }, { status: 500 })
  }
}
