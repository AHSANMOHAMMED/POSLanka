import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pricingTiers, systemSettings } from '@/lib/db/schema'
import { adminAuthError, adminAudit, withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { invalidateSettingsCache } from '@/lib/billing/settings'
import { PAID_GRACE_DAYS } from '@/lib/billing/subscription-state'
import { isS3Configured } from '@/lib/files/r2'
import { SETTING_DEFAULTS, SETTING_DESCRIPTIONS, SETTING_KEYS, SETTING_SCHEMAS, isSettingKey, type SettingKey } from '@/lib/admin/platform-settings'

function payhereStatus() {
  return {
    configured: !!(process.env.PAYHERE_MERCHANT_ID && process.env.PAYHERE_MERCHANT_SECRET),
    sandbox: process.env.PAYHERE_SANDBOX === 'true',
  }
}

/**
 * GET /api/sys-control/settings — every editable platform setting (saved value merged over the
 * default), when each was last saved, plans for the offer picker and read-only platform status.
 * `?key=` returns a single setting (`payhere_status` is derived from the environment).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    const key = request.nextUrl.searchParams.get('key')
    if (key) {
      if (key === 'payhere_status') return NextResponse.json({ key, value: payhereStatus() })
      const setting = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, key) })
      return NextResponse.json(setting || { key, value: isSettingKey(key) ? SETTING_DEFAULTS[key] : {} })
    }

    const [rows, tiers] = await Promise.all([
      db.select({ key: systemSettings.key, value: systemSettings.value, updatedAt: systemSettings.updatedAt })
        .from(systemSettings)
        .where(inArray(systemSettings.key, SETTING_KEYS)),
      db.select({ id: pricingTiers.id, displayName: pricingTiers.displayName, isActive: pricingTiers.isActive })
        .from(pricingTiers)
        .orderBy(asc(pricingTiers.sortOrder), asc(pricingTiers.priceMonthly)),
    ])
    const byKey = new Map(rows.map((r) => [r.key, r]))
    const settings = Object.fromEntries(SETTING_KEYS.map((k) => {
      const saved = byKey.get(k)?.value
      const def = SETTING_DEFAULTS[k] as Record<string, unknown>
      return [k, saved && typeof saved === 'object' ? { ...def, ...(saved as Record<string, unknown>) } : def]
    }))
    const updatedAt = Object.fromEntries(SETTING_KEYS.map((k) => [k, byKey.get(k)?.updatedAt ?? null]))

    return NextResponse.json({
      settings,
      updatedAt,
      tiers,
      platform: {
        appName: process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS',
        baseUrl: process.env.NEXTAUTH_URL || request.nextUrl.origin,
        environment: process.env.NODE_ENV,
        emailConfigured: !!process.env.RESEND_API_KEY,
        emailFrom: process.env.SYSTEM_EMAIL_FROM || 'noreply@poslanka.lk',
        storageConfigured: isS3Configured(),
        payhere: payhereStatus(),
        graceDays: PAID_GRACE_DAYS,
      },
    })
  } catch (error) {
    logError('api/sys-control/settings', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

const putSchema = z.object({
  key: z.string().trim().min(1).max(100),
  value: z.unknown(),
})

/**
 * PUT /api/sys-control/settings — save one setting. The value is validated against that key's
 * schema (unknown keys are refused), the public settings cache is cleared and the change audited.
 */
export async function PUT(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/settings')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession('settings')
    if (!session) {
      return adminAuthError()
    }

    const parsed = await validateBody(request, putSchema)
    if (!parsed.success) return parsed.response
    const { key } = parsed.data
    if (!isSettingKey(key)) {
      return NextResponse.json({ error: `Unknown setting "${key}"` }, { status: 400 })
    }
    const checked = (SETTING_SCHEMAS[key] as z.ZodType).safeParse(parsed.data.value)
    if (!checked.success) {
      return NextResponse.json({
        error: 'Please fix the highlighted fields',
        details: checked.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      }, { status: 400 })
    }
    const value = checked.data as Record<string, unknown>

    const existing = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, key) })
    const now = new Date()
    const [saved] = await db.insert(systemSettings)
      .values({ key, value, description: SETTING_DESCRIPTIONS[key as SettingKey] })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: now } })
      .returning()

    invalidateSettingsCache(key)

    const before = (existing?.value ?? {}) as Record<string, unknown>
    const changed = Object.keys(value).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(value[k]))
    await adminAudit.update(session.superAdminId, 'setting', saved.id, { op: 'save_setting', key, changed })

    return NextResponse.json({ key, value: saved.value, updatedAt: saved.updatedAt })
  } catch (error) {
    logError('api/sys-control/settings', error)
    return NextResponse.json({ error: 'Failed to save the setting' }, { status: 500 })
  }
}
