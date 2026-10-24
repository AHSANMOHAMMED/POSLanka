import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { TopUpError, topUpCredits, topUpSchema } from '@/lib/messaging/admin'

/**
 * POST /api/sys-control/vendors/[id]/messaging/topup — add prepaid SMS / WhatsApp credits
 * (negative = correction). Atomic; writes a ledger row and an audit entry.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await withRateLimit('/api/sys-control/vendors/messaging/topup')
    if (limited) return limited
    const session = await validateAdminSession('billing')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, topUpSchema)
    if (!parsed.success) return parsed.response

    const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, p.data.id)).limit(1)
    if (!t) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    try {
      const { balance, entry } = await topUpCredits(t.id, parsed.data, session.superAdminId)
      await adminAudit.update(session.superAdminId, 'messaging_credits', t.id, {
        op: 'messaging_topup', channel: parsed.data.channel, change: parsed.data.credits, balanceAfter: balance,
        amountPaid: parsed.data.amountPaid ?? null, ledgerId: entry.id,
      })
      return NextResponse.json({ balance, entry })
    } catch (e) {
      if (e instanceof TopUpError) return NextResponse.json({ error: e.message }, { status: e.status })
      throw e
    }
  } catch (error) {
    logError('api/sys-control/vendors/[id]/messaging/topup', error)
    return NextResponse.json({ error: 'Failed to top up' }, { status: 500 })
  }
}
