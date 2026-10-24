import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { hasPermission, requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { messagingSubscriptions } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { getSubscription, messagingAvailability } from '@/lib/messaging/service'
import { describePlan, listLedger, usageThisMonth } from '@/lib/messaging/admin'
import { normalizeMsisdn } from '@/lib/messaging/phone'

/**
 * GET /api/messaging — the business's SMS / WhatsApp plan.
 * Everyone signed in gets `available` (the POS / mobile app use it to choose between sending through
 * the server and the free share link); owners / managers also get the plan, balances, usage and top-ups.
 */
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = session.user.tenantId
    const available = await messagingAvailability(tenantId)
    const u = session.user as { role: string; customRoleId?: string }
    const canSee = hasPermission(u.role, 'manageSettings', tenantId, u.customRoleId) || hasPermission(u.role, 'viewActivityLogs', tenantId, u.customRoleId)
    if (!canSee) return NextResponse.json({ available })
    const sub = await getSubscription(tenantId)
    if (!sub) return NextResponse.json({ available, subscribed: false })
    const [usage, ledger] = await Promise.all([usageThisMonth(tenantId), listLedger(tenantId, 20)])
    const plan = describePlan(sub)
    return NextResponse.json({
      available,
      subscribed: true,
      plan: { ...plan, notes: undefined },
      usage,
      ledger: ledger.map((l) => ({ id: l.id, channel: l.channel, change: l.change, balanceAfter: l.balanceAfter, reason: l.reason, createdAt: l.createdAt })),
    })
  } catch (error) {
    logError('api/messaging GET', error)
    return NextResponse.json({ error: 'Failed to load messaging plan' }, { status: 500 })
  }
}

const alertSchema = z.object({
  alertPhone: z.string().trim().max(30).refine((v) => v === '' || !!normalizeMsisdn(v), 'Enter a valid mobile number'),
  lowStockChannel: z.enum(['off', 'sms', 'whatsapp']),
})

/** PUT /api/messaging — the owner's alert phone and the channel for low-stock alerts. */
export async function PUT(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'manageSettings')
    if (perm) return perm
    const parsed = await validateBody(request, alertSchema, { keepEmptyStrings: true })
    if (!parsed.success) return parsed.response
    const { alertPhone, lowStockChannel } = parsed.data
    if (lowStockChannel !== 'off' && !alertPhone) return NextResponse.json({ error: 'Enter the phone number for alerts' }, { status: 400 })
    const tenantId = session.user.tenantId
    const sub = await getSubscription(tenantId)
    if (!sub) return NextResponse.json({ error: 'This business has no SMS / WhatsApp plan', code: 'NOT_SUBSCRIBED' }, { status: 409 })
    if (lowStockChannel === 'sms' && !sub.smsEnabled) return NextResponse.json({ error: 'SMS is not part of your plan' }, { status: 400 })
    if (lowStockChannel === 'whatsapp' && !sub.whatsappEnabled) return NextResponse.json({ error: 'WhatsApp is not part of your plan' }, { status: 400 })
    await withTenant(tenantId, (tdb) => tdb.update(messagingSubscriptions)
      .set({ alertPhone: alertPhone ? normalizeMsisdn(alertPhone) : null, lowStockChannel, updatedAt: new Date() })
      .where(eq(messagingSubscriptions.tenantId, tenantId)))
    return NextResponse.json({ ok: true, alertPhone: alertPhone ? normalizeMsisdn(alertPhone) : null, lowStockChannel })
  } catch (error) {
    logError('api/messaging PUT', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
