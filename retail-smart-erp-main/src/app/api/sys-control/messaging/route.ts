import { NextResponse } from 'next/server'
import { desc, eq, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { messagingSubscriptions, tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { maskedPlatformConfig, platformConfigPatchSchema, savePlatformConfig } from '@/lib/messaging/platform-config'
import { describePlan } from '@/lib/messaging/admin'

/**
 * GET /api/sys-control/messaging — platform SMS / WhatsApp accounts (secrets masked: set + last 4
 * characters only) and the vendors that have a messaging plan.
 */
export async function GET() {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()

    const [masked, subs] = await Promise.all([
      maskedPlatformConfig(),
      db.select({ sub: messagingSubscriptions, name: tenants.name, slug: tenants.slug, businessId: tenants.businessId })
        .from(messagingSubscriptions)
        .innerJoin(tenants, eq(tenants.id, messagingSubscriptions.tenantId))
        .where(or(eq(messagingSubscriptions.smsEnabled, true), eq(messagingSubscriptions.whatsappEnabled, true)))
        .orderBy(desc(messagingSubscriptions.updatedAt))
        .limit(500),
    ])
    return NextResponse.json({
      ...masked,
      vendors: subs.map((s) => ({ tenantId: s.sub.tenantId, name: s.name, slug: s.slug, businessId: s.businessId, plan: describePlan(s.sub) })),
    })
  } catch (error) {
    logError('api/sys-control/messaging GET', error)
    return NextResponse.json({ error: 'Failed to load messaging settings' }, { status: 500 })
  }
}

/**
 * PUT /api/sys-control/messaging — save provider settings. Secret fields: a non-empty value
 * replaces the saved one, a missing / blank one keeps it, `clearSecrets` removes. Audited with the
 * names of the changed fields only (never the values).
 */
export async function PUT(request: Request) {
  try {
    const limited = await withRateLimit('/api/sys-control/messaging')
    if (limited) return limited
    const session = await validateAdminSession('settings')
    if (!session) return adminAuthError()

    const parsed = await validateBody(request, platformConfigPatchSchema, { keepEmptyStrings: true })
    if (!parsed.success) return parsed.response
    const { changed, id } = await savePlatformConfig(parsed.data)
    if (id) await adminAudit.update(session.superAdminId, 'setting', id, { op: 'save_messaging_providers', key: 'messaging_providers', changed })
    return NextResponse.json({ ...(await maskedPlatformConfig()), changed })
  } catch (error) {
    logError('api/sys-control/messaging PUT', error)
    return NextResponse.json({ error: 'Failed to save messaging settings' }, { status: 500 })
  }
}
