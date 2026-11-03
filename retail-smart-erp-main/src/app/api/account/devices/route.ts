import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { accountAuth } from '@/lib/auth/account-auth'
import { validateAdminSession } from '@/lib/admin'
import { db } from '@/lib/db'
import { userDevices } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { isExpoToken } from '@/lib/notifications/push'
import { clientIp, consumeRateLimit, rateLimitedResponse } from '@/lib/auth/rate-limit'

const MAX_DEVICES_PER_PRINCIPAL = 10

const registerSchema = z.object({
  pushToken: z.string().min(10).max(255).refine(isExpoToken, 'Not a valid Expo push token'),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
  deviceName: z.string().max(255).optional(),
  appVersion: z.string().max(50).optional(),
})
const unregisterSchema = z.object({
  pushToken: z.string().min(10).max(255).refine(isExpoToken, 'Not a valid Expo push token'),
})

type Owner = {
  tenantId: string | null
  userId: string | null
  accountId: string | null
  superAdminId: string | null
}

async function resolveOwner(): Promise<Owner | null> {
  const company = await authWithCompany()
  if (company?.user?.tenantId) return { tenantId: company.user.tenantId, userId: company.user.id, accountId: company.user.accountId || null, superAdminId: null }
  const admin = await validateAdminSession('self')
  if (admin) return { tenantId: null, userId: null, accountId: null, superAdminId: admin.superAdminId }
  const account = await accountAuth()
  const accountId = (account?.user as { accountId?: string } | undefined)?.accountId
  if (accountId) return { tenantId: null, userId: null, accountId, superAdminId: null }
  return null
}

function sameOwner(row: {
  tenantId: string | null
  userId: string | null
  accountId: string | null
  superAdminId: string | null
}, owner: Owner): boolean {
  if (owner.userId) return row.userId === owner.userId && row.tenantId === owner.tenantId
  if (owner.superAdminId) return row.superAdminId === owner.superAdminId
  if (owner.accountId) return row.accountId === owner.accountId
  return false
}

function ownerWhere(owner: Owner) {
  if (owner.userId) return and(eq(userDevices.tenantId, owner.tenantId!), eq(userDevices.userId, owner.userId))
  if (owner.superAdminId) return eq(userDevices.superAdminId, owner.superAdminId)
  return eq(userDevices.accountId, owner.accountId!)
}

/** GET /api/account/devices — devices registered for the caller */
export async function GET() {
  const owner = await resolveOwner()
  if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db.select().from(userDevices).where(ownerWhere(owner))
  return NextResponse.json({ devices: rows.map(({ pushToken, ...r }) => ({ ...r, pushToken: pushToken.slice(0, 20) + '…' })) })
}

/** POST /api/account/devices — register (or refresh) an Expo push token */
export async function POST(request: NextRequest) {
  try {
    const owner = await resolveOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, registerSchema)
    if (!parsed.success) return parsed.response
    const { pushToken, platform, deviceName, appVersion } = parsed.data

    const existing = await db.query.userDevices.findFirst({
      where: eq(userDevices.pushToken, pushToken),
    })

    if (existing && !sameOwner(existing, owner)) {
      return NextResponse.json({
        error: 'This device token is already registered to another account. Sign out there first, or reinstall the app.',
      }, { status: 409 })
    }

    if (existing && sameOwner(existing, owner)) {
      await db.update(userDevices).set({
        platform,
        deviceName: deviceName || existing.deviceName,
        appVersion: appVersion || existing.appVersion,
        lastSeenAt: new Date(),
      }).where(eq(userDevices.id, existing.id))
      return NextResponse.json({ ok: true })
    }

    // Cap devices per principal; drop the oldest when at/over the limit
    const existingDevices = await db.select({ id: userDevices.id })
      .from(userDevices)
      .where(ownerWhere(owner))
      .orderBy(asc(userDevices.lastSeenAt), asc(userDevices.createdAt))
    if (existingDevices.length >= MAX_DEVICES_PER_PRINCIPAL) {
      const toDrop = existingDevices.slice(0, existingDevices.length - MAX_DEVICES_PER_PRINCIPAL + 1).map((r) => r.id)
      if (toDrop.length) await db.delete(userDevices).where(inArray(userDevices.id, toDrop))
    }

    await db.insert(userDevices).values({
      tenantId: owner.tenantId,
      userId: owner.userId,
      accountId: owner.accountId,
      superAdminId: owner.superAdminId,
      pushToken,
      platform,
      deviceName: deviceName || null,
      appVersion: appVersion || null,
      lastSeenAt: new Date(),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/account/devices POST', error)
    return NextResponse.json({ error: 'Failed to register device' }, { status: 500 })
  }
}

/** DELETE /api/account/devices — unregister a token (logout).
 * Live-safe: if the session already expired (401 on other calls), still allow delete by
 * possession of the Expo push token itself so stale device rows are cleared on sign-out.
 */
export async function DELETE(request: NextRequest) {
  try {
    const parsed = await validateBody(request, unregisterSchema)
    if (!parsed.success) return parsed.response
    const owner = await resolveOwner()
    if (owner) {
      await db.delete(userDevices).where(and(eq(userDevices.pushToken, parsed.data.pushToken), ownerWhere(owner)))
    } else {
      const limit = await consumeRateLimit(clientIp(request), {
        maxAttempts: 30,
        windowMs: 60_000,
        category: 'device_unregister',
      })
      if (limit.limited) return rateLimitedResponse(limit)
      // Token is the secret (Expo push token entropy + isExpoToken).
      await db.delete(userDevices).where(eq(userDevices.pushToken, parsed.data.pushToken))
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/account/devices DELETE', error)
    return NextResponse.json({ error: 'Failed to unregister device' }, { status: 500 })
  }
}
