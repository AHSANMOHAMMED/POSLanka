import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gt, and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { sendPaymentReminder } from '@/lib/messaging/actions'
import { httpStatusFor, type SendMessageResult } from '@/lib/messaging/service'

const schema = z.object({
  channel: z.enum(['sms', 'whatsapp']),
  /** one customer … */
  customerId: z.string().uuid().optional(),
  /** … or every customer with an outstanding balance (at most 200 per request) */
  allWithBalance: z.boolean().optional(),
}).refine((v) => !!v.customerId !== !!v.allWithBalance, 'Choose one customer or all customers with a balance')

/**
 * POST /api/messaging/payment-reminder — remind credit customers of their outstanding balance.
 * Bulk sends stop at the first "no credit / quota used up / plan" refusal.
 */
export async function POST(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'manageCustomerCredit')
    if (perm) return perm
    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const { channel, customerId } = parsed.data
    const tenantId = session.user.tenantId

    if (customerId) {
      const r = await sendPaymentReminder({ tenantId, customerId, channel, userId: session.user.id })
      if (r.notFound) return NextResponse.json({ ...r, error: 'Customer not found' }, { status: 404 })
      return NextResponse.json(r, { status: r.ok ? 200 : r.code === 'PROVIDER_REJECTED' && !r.logId ? 400 : httpStatusFor(r) })
    }

    const ids = await withTenant(tenantId, (tdb) => tdb.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.tenantId, tenantId), gt(customers.balance, '0')))
      .limit(200))
    const results: Array<{ customerId: string } & SendMessageResult> = []
    const STOP = new Set(['NO_CREDIT', 'QUOTA_EXHAUSTED', 'NOT_SUBSCRIBED', 'CHANNEL_DISABLED', 'FEATURE_DISABLED', 'SUBSCRIPTION_EXPIRED', 'PROVIDER_NOT_CONFIGURED', 'OWN_PROVIDER_NOT_CONFIGURED'])
    let stopped: SendMessageResult | null = null
    for (const { id } of ids) {
      const r = await sendPaymentReminder({ tenantId, customerId: id, channel, userId: session.user.id })
      results.push({ customerId: id, ...r })
      if (!r.ok && STOP.has(r.code)) { stopped = r; break }
    }
    return NextResponse.json({
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      stopped: stopped ? { code: stopped.code, error: stopped.error } : null,
      results: results.map((r) => ({ customerId: r.customerId, ok: r.ok, code: r.code, error: r.error })),
    })
  } catch (error) {
    logError('api/messaging/payment-reminder', error)
    return NextResponse.json({ error: 'Failed to send reminders' }, { status: 500 })
  }
}
