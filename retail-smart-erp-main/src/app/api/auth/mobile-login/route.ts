import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'
import { isAccountActive } from '@/lib/auth/live-user'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit, LOGIN_RATE_LIMIT } from '@/lib/auth/rate-limit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().min(1),
})

/**
 * Mobile JWT login for Expo POS app.
 * Returns a bearer token accepted by Authorization header on API routes
 * that use authWithCompany (via custom header bridge below).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const parsed = await validateBody(request, schema)
  if (!parsed.success) return parsed.response

  const email = parsed.data.email.toLowerCase()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const rateKey = `mobile:${parsed.data.tenantSlug}:${email}:${ip}`
  const limit = await checkRateLimit(rateKey, LOGIN_RATE_LIMIT)
  if (limit.limited) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in a few minutes.' }, { status: 429 })
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, parsed.data.tenantSlug),
  })
  if (!tenant || tenant.status !== 'active') {
    await recordRateLimitAttempt(rateKey, LOGIN_RATE_LIMIT)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  // Same rule as the web login: an expired plan cannot sign in from the app either.
  if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const user = await withTenant(tenant.id, async (tdb) =>
    tdb.query.users.findFirst({
      where: and(eq(users.email, email), eq(users.tenantId, tenant.id), eq(users.isActive, true)),
    })
  )
  if (!user) {
    await recordRateLimitAttempt(rateKey, LOGIN_RATE_LIMIT)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!valid || (user.accountId && !(await isAccountActive(user.accountId)))) {
    await recordRateLimitAttempt(rateKey, LOGIN_RATE_LIMIT)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  await clearRateLimit(rateKey, LOGIN_RATE_LIMIT.category).catch(() => undefined)
  await withTenant(tenant.id, async (tdb) =>
    tdb.update(users).set({ lastLoginAt: new Date(), lastActiveAt: new Date() }).where(eq(users.id, user.id))
  ).catch(() => undefined)

  const token = jwt.sign(
    {
      type: 'mobile',
      sub: user.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessType: tenant.businessType,
      aiEnabled: tenant.aiEnabled,
      accountId: user.accountId || null,
      customRoleId: user.customRoleId || null,
      role: user.role,
      email: user.email,
      name: user.fullName,
    },
    secret,
    { expiresIn: '12h' }
  )

  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessType: tenant.businessType,
    },
  })
}
