import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db'
import { purchases, purchaseItems } from '@/lib/db/schema'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { evaluateThreeWayMatch } from '@/lib/purchasing/three-way-match'
import { requireAnyPermission, PURCHASING_VIEW_PERMISSIONS } from '@/lib/purchasing/permissions'

// GET /api/purchases/[id]/match — 3-way match (invoice vs PO vs GRN). Submitted invoices return
// the result stored at submit; drafts are evaluated live (preview before submitting).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  const result = await withAuthTenant(async (session, db) => {
    const permError = requireAnyPermission(session, PURCHASING_VIEW_PERMISSIONS)
    if (permError) return { error: permError }
    const [purchase] = await db.select().from(purchases).where(eq(purchases.id, p.data.id))
    if (!purchase) return { error: NextResponse.json({ error: 'Purchase not found' }, { status: 404 }) }
    if (purchase.status !== 'draft' && purchase.matchDetails) {
      return { data: { ...(purchase.matchDetails as object), stored: true } }
    }
    const lines = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, purchase.id))
    const match = await evaluateThreeWayMatch(db, {
      tenantId: session.user.tenantId,
      purchaseOrderId: purchase.purchaseOrderId,
      purchaseId: purchase.id,
      lines: lines.map(l => ({ itemId: l.itemId, itemName: l.itemName, quantity: parseFloat(l.quantity), unitPrice: parseFloat(l.unitPrice) })),
    })
    return { data: { ...match, stored: false } }
  })
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) return result.error
  return NextResponse.json(result.data)
}
