import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { smsSettings, tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { getSubscription } from '@/lib/messaging/service'
import { describePlan, emptySubscription, listLedger, saveSubscription, subscriptionSchema, usageThisMonth } from '@/lib/messaging/admin'
import { maskedPlatformConfig } from '@/lib/messaging/platform-config'

type Ctx = { params: Promise<{ id: string }> }

async function vendorPayload(tenantId: string) {
  const [sub, usage, ledger, flags, platform, own] = await Promise.all([
    getSubscription(tenantId),
    usageThisMonth(tenantId),
    listLedger(tenantId, 30),
    getTenantFeatureFlags(tenantId),
    maskedPlatformConfig(),
    db.select({ provider: smsSettings.provider, isEnabled: smsSettings.isEnabled }).from(smsSettings).where(eq(smsSettings.tenantId, tenantId)).limit(1),
  ])
  return {
    subscribed: !!sub,
    plan: describePlan(sub ?? emptySubscription(tenantId)),
    usage,
    ledger,
    featureFlags: { sms: flags.sms, whatsapp: flags.whatsapp },
    platformReady: platform.status,
    platformSender: platform.config.sms.provider === 'none' ? null : (platform.config.sms as unknown as Record<string, { senderId?: string }>)[platform.config.sms.provider]?.senderId || null,
    ownProvider: own[0] ? { provider: own[0].provider, enabled: own[0].isEnabled } : null,
  }
}

/** GET /api/sys-control/vendors/[id]/messaging — plan, balances, this month's usage, top-ups. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const [t] = await db.select({ id: tenants.id, name: tenants.name, businessId: tenants.businessId, phone: tenants.phone }).from(tenants).where(eq(tenants.id, p.data.id)).limit(1)
    if (!t) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    return NextResponse.json({ vendor: t, ...(await vendorPayload(t.id)) })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/messaging GET', error)
    return NextResponse.json({ error: 'Failed to load messaging plan' }, { status: 500 })
  }
}

/** PUT — create / change the vendor's messaging plan (billing). Channels turned on switch their feature on. */
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const limited = await withRateLimit('/api/sys-control/vendors/messaging')
    if (limited) return limited
    const session = await validateAdminSession('billing')
    if (!session) return adminAuthError()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, subscriptionSchema, { keepEmptyStrings: true })
    if (!parsed.success) return parsed.response

    const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, p.data.id)).limit(1)
    if (!t) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const before = await getSubscription(t.id)
    const saved = await saveSubscription(t.id, parsed.data, session.superAdminId)
    const prev = before ? describePlan(before) : null
    const next = describePlan(saved)
    const changed = (Object.keys(next) as Array<keyof typeof next>)
      .filter((k) => k !== 'updatedAt' && JSON.stringify(prev?.[k]) !== JSON.stringify(next[k]))
    await adminAudit.update(session.superAdminId, 'messaging_subscription', t.id, {
      op: before ? 'update_messaging_plan' : 'create_messaging_plan',
      changed,
      sms: next.smsEnabled, whatsapp: next.whatsappEnabled, billingMode: next.billingMode, expiresAt: next.expiresAt,
    })
    return NextResponse.json(await vendorPayload(t.id))
  } catch (error) {
    logError('api/sys-control/vendors/[id]/messaging PUT', error)
    return NextResponse.json({ error: 'Failed to save messaging plan' }, { status: 500 })
  }
}
