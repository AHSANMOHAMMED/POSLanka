import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { accountAuth } from '@/lib/auth/account-auth'
import { validateAdminSession } from '@/lib/admin'
import { db } from '@/lib/db'
import { userDevices } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'

const registerSchema = z.object({
  pushToken: z.string().min(10).max(255),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
  deviceName: z.string().max(255).optional(),
  appVersion: z.string().max(50).optional(),
})
const unregisterSchema = z.object({ pushToken: z.string().min(10).max(255) })

async function resolveOwner() {
  const company = await authWithCompany()
  if (company?.user?.tenantId) return { tenantId: company.user.tenantId, userId: company.user.id, accountId: company.user.accountId || null, superAdminId: null }
  const admin = await validateAdminSession()
  if (admin) return { tenantId: null, userId: null, accountId: null, superAdminId: admin.superAdminId }
  const account = await accountAuth()
  const accountId = (account?.user as { accountId?: string } | undefined)?.accountId
  if (accountId) return { tenantId: null, userId: null, accountId, superAdminId: null }
  return null
}

/** GET /api/account/devices — devices registered for the caller */
export async function GET() {
  const owner = await resolveOwner()
  if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const where = owner.userId
    ? and(eq(userDevices.tenantId, owner.tenantId!), eq(userDevices.userId, owner.userId))
    : owner.superAdminId ? eq(userDevices.superAdminId, owner.superAdminId) : eq(userDevices.accountId, owner.accountId!)
  const rows = await db.select().from(userDevices).where(where)
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

    await db.insert(userDevices).values({
      tenantId: owner.tenantId, userId: owner.userId, accountId: owner.accountId, superAdminId: owner.superAdminId,
      pushToken, platform, deviceName: deviceName || null, appVersion: appVersion || null, lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: userDevices.pushToken,
      set: {
        tenantId: owner.tenantId, userId: owner.userId, accountId: owner.accountId, superAdminId: owner.superAdminId,
        platform, deviceName: deviceName || null, appVersion: appVersion || null, lastSeenAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/account/devices POST', error)
    return NextResponse.json({ error: 'Failed to register device' }, { status: 500 })
  }
}

/** DELETE /api/account/devices — unregister a token (logout) */
export async function DELETE(request: NextRequest) {
  try {
    const owner = await resolveOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = await validateBody(request, unregisterSchema)
    if (!parsed.success) return parsed.response
    // Only the caller's own registration can be removed (never another company's/account's device)
    const ownerFilter = owner.userId
      ? and(eq(userDevices.tenantId, owner.tenantId!), eq(userDevices.userId, owner.userId))
      : owner.superAdminId ? eq(userDevices.superAdminId, owner.superAdminId) : eq(userDevices.accountId, owner.accountId!)
    await db.delete(userDevices).where(and(eq(userDevices.pushToken, parsed.data.pushToken), ownerFilter))
    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('api/account/devices DELETE', error)
    return NextResponse.json({ error: 'Failed to unregister device' }, { status: 500 })
  }
}
