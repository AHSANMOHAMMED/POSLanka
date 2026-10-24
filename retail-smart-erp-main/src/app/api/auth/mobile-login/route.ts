import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { validateBody } from '@/lib/validation/helpers'
import { isAccountActive } from '@/lib/auth/live-user'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit, LOGIN_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { findTenantByIdentifier, normalizeBusinessId } from '@/lib/tenant/business-id'
import { findLoginUser } from '@/lib/auth/login-identity'
import { getEffectivePermissions } from '@/lib/auth/roles'

// Business ID (preferred, e.g. "PL-985633") or the legacy company slug (older app installs).
const schema = z.object({
  /** Email or username (see findLoginUser) */
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1),
  businessId: z.string().trim().min(1).max(32).optional(),
  tenantSlug: z.string().trim().min(1).max(100).optional(),
}).refine((v) => !!(v.businessId || v.tenantSlug), {
  message: 'Business ID is required',
  path: ['businessId'],
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
  const identifier = (parsed.data.businessId || parsed.data.tenantSlug || '').trim()

  const tenant = await findTenantByIdentifier(identifier)
  // Rate-limit per resolved company (so "PL-985633", "pl985633" and the slug share one bucket);
  // an unknown identifier gets its own normalised bucket so guessing is limited too.
  const rateKey = `mobile:${tenant?.id ?? `unknown:${normalizeBusinessId(identifier) ?? identifier.toLowerCase()}`}:${email}:${ip}`
  const limit = await checkRateLimit(rateKey, LOGIN_RATE_LIMIT)
  if (limit.limited) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in a few minutes.' }, { status: 429 })
  }

  if (!tenant || tenant.status !== 'active') {
    await recordRateLimitAttempt(rateKey, LOGIN_RATE_LIMIT)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  // Same rule as the web login: an expired plan cannot sign in from the app either.
  if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const user = await withTenant(tenant.id, (tdb) => findLoginUser(tdb, tenant, email, { activeOnly: true }))
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
      authAt: Date.now(), // ms sign-in time for the password-change check (iat is whole seconds)
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessId: tenant.businessId,
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

  // Effective permissions (custom role, tenant overrides, module access) so the app shows only
  // what this user may use; the server still enforces every call.
  let permissions: Record<string, boolean> | undefined
  let customRoleName: string | null = null
  try {
    const cache = await import('@/lib/auth/permission-cache')
    await cache.warmPermissionCache(tenant.id)
    permissions = getEffectivePermissions(user.role, tenant.id, user.customRoleId)
    customRoleName = user.customRoleId ? cache.getCustomRoleName(tenant.id, user.customRoleId) ?? null : null
  } catch {
    // The app falls back to role defaults and refreshes from /api/role-permissions/effective
  }

  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
      customRoleId: user.customRoleId || null,
      customRoleName,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessId: tenant.businessId,
      businessType: tenant.businessType,
      permissions,
    },
  })
}
