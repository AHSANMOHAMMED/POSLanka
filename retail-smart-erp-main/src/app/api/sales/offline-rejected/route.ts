import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, or } from 'drizzle-orm'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { sales } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { logActivity } from '@/lib/utils/activity-log'
import { notify } from '@/lib/notifications/notify'

const offlineRejectedSchema = z.object({
  clientSaleId: z.string().uuid(),
  offlineRef: z.string().trim().min(1).max(40).optional(),
  error: z.string().trim().min(1).max(1000),
  status: z.number().int().min(0).max(599).optional(),
  summary: z.object({
    total: z.number().finite().optional(),
    itemCount: z.number().int().min(0).max(100000).optional(),
    paymentMethod: z.string().max(30).optional(),
    queuedAt: z.string().max(40).optional(),
    warehouseId: z.string().uuid().optional(),
  }).optional(),
})

// POST /api/sales/offline-rejected — the mobile POS reports an offline sale the server rejected
// while replaying its queue (W6). Records an activity log entry and alerts managers.
// → { recorded: true } or { recorded: false, sale: { id, invoiceNo } } when the sale exists after all.
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'createSales')
    if (permError) return permError

    const parsed = await validateBody(request, offlineRejectedSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const tenantId = session.user.tenantId
    const userId = await resolveUserIdRequired(session)

    const existing = await withTenant(tenantId, (db) => db.query.sales.findFirst({
      where: and(
        eq(sales.tenantId, tenantId),
        body.offlineRef
          ? or(eq(sales.clientSaleId, body.clientSaleId), eq(sales.offlineRef, body.offlineRef))
          : eq(sales.clientSaleId, body.clientSaleId),
      ),
      columns: { id: true, invoiceNo: true },
    }))
    if (existing) {
      return NextResponse.json({ recorded: false, sale: existing })
    }

    const ref = body.offlineRef || body.clientSaleId.slice(0, 8).toUpperCase()
    const amount = body.summary?.total !== undefined ? ` (${body.summary.total.toFixed(2)})` : ''
    await logActivity({
      tenantId,
      userId,
      action: 'reject',
      entityType: 'sale',
      entityName: ref,
      description: `Offline sale ${ref}${amount} was rejected by the server: ${body.error}`,
      metadata: { offlineSaleRejected: true, ...body },
    })
    void notify(tenantId, 'offline_sale_rejected', {
      title: `Offline sale ${ref} was rejected`,
      body: `${session.user.name || 'A cashier'}: ${body.error}`.slice(0, 240),
      data: { screen: 'pos', clientSaleId: body.clientSaleId, offlineRef: body.offlineRef || null },
      dedupeKey: `offline_sale_rejected:${body.clientSaleId}`,
      permission: 'manageSales',
    })
    return NextResponse.json({ recorded: true })
  } catch (error) {
    logError('api/sales/offline-rejected', error)
    return NextResponse.json({ error: 'Failed to record rejected offline sale' }, { status: 500 })
  }
}
