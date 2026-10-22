import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { getPurchasingSettings, savePurchasingSettings } from '@/lib/purchasing/settings'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'

const schema = z.object({
  matchPriceTolerancePct: z.coerce.number().min(0).max(1000).optional(),
  matchQtyTolerancePct: z.coerce.number().min(0).max(1000).optional(),
  matchAction: z.enum(['warn', 'block']).optional(),
  autoReorder: z.boolean().optional(),
})

// GET /api/purchasing/settings — 3-way match tolerances / action, auto reorder
export async function GET() {
  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    return { data: await getPurchasingSettings(db, session.user.tenantId) }
  })
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}

// PUT /api/purchasing/settings
export async function PUT(request: NextRequest) {
  const parsed = await validateBody(request, schema)
  if (!parsed.success) return parsed.response
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'managePurchases')
    if (permError) return { error: permError }
    const saved = await savePurchasingSettings(db, session.user.tenantId, parsed.data)
    logAndBroadcast(session.user.tenantId, 'settings', 'updated', session.user.tenantId, { userId: session.user.id })
    return { data: saved }
  })
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
