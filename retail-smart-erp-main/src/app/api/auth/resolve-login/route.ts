import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, withTenant, withoutTenant } from '@/lib/db'
import { accounts, tenants, users } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit, LOGIN_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { findTenantByIdentifier } from '@/lib/tenant/business-id'
import { findLoginUser } from '@/lib/auth/login-identity'
import { landingPathForRole } from '@/lib/auth/landing'
import { logError } from '@/lib/ai/error-logger'

const schema = z.object({
  login: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
  businessId: z.string().trim().max(100).optional(),
})

type Target =
  | { kind: 'owner' }
  | { kind: 'staff'; slug: string; name: string; landing: string }
  | { kind: 'choose'; companies: Array<{ slug: string; name: string }> }

const INVALID = { error: 'Those details don’t match. Check your Business ID, username and password.' }

/**
 * POST /api/auth/resolve-login — one sign-in form for everyone. Works out who is signing in from
 * the credentials (the session itself is then created by the matching sign-in provider):
 *   Business ID given              → that shop's staff member (any role)
 *   email, owner-account password  → owner account
 *   email, staff password          → the one shop with that login (several → { kind: 'choose' })
 *   username without Business ID   → 400 (the shop is needed)
 * Returns the landing page for the staff member's role. Rate limited like the other sign-ins;
 * failures never reveal which part was wrong.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const login = parsed.data.login.toLowerCase()
    const { password } = parsed.data
    const businessId = parsed.data.businessId?.trim()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
    const rateKey = `resolve:${login}:${ip}`
    const limit = await checkRateLimit(rateKey, LOGIN_RATE_LIMIT)
    if (limit.limited) return NextResponse.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, { status: 429 })
    const fail = async (status = 401, body: Record<string, unknown> = INVALID) => {
      await recordRateLimitAttempt(rateKey, LOGIN_RATE_LIMIT)
      return NextResponse.json(body, { status })
    }
    const ok = async (target: Target) => {
      await clearRateLimit(rateKey, LOGIN_RATE_LIMIT.category).catch(() => undefined)
      return NextResponse.json(target)
    }

    // 1. A shop was named: its staff member
    if (businessId) {
      const tenant = await findTenantByIdentifier(businessId)
      if (!tenant || tenant.status !== 'active') return fail()
      const user = await withTenant(tenant.id, (tdb) => findLoginUser(tdb, tenant, login, { activeOnly: true }))
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return fail()
      return ok({ kind: 'staff', slug: tenant.slug, name: tenant.name, landing: landingPathForRole(user.role, tenant.businessType) })
    }

    if (!login.includes('@')) {
      return fail(400, { error: 'Enter your Business ID (your shop’s name, e.g. alisha-shop) to sign in with a username.', field: 'businessId' })
    }

    // 2. Owner account
    const account = await db.query.accounts.findFirst({ where: eq(accounts.email, login), columns: { passwordHash: true, isActive: true } })
    if (account?.passwordHash && account.isActive !== false && (await bcrypt.compare(password, account.passwordHash))) {
      return ok({ kind: 'owner' })
    }

    // 3. Staff login by email across shops (only shops where the password matches)
    const rows = await withoutTenant((tdb) => tdb
      .select({ hash: users.passwordHash, role: users.role, slug: tenants.slug, name: tenants.name, businessType: tenants.businessType })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(sql`lower(${users.email}) = ${login}`, eq(users.isActive, true), eq(tenants.status, 'active')))
      .limit(20))
    const matches: typeof rows = []
    for (const r of rows) if (await bcrypt.compare(password, r.hash)) matches.push(r)
    if (matches.length === 0) return fail()
    if (matches.length === 1) {
      const m = matches[0]
      return ok({ kind: 'staff', slug: m.slug, name: m.name, landing: landingPathForRole(m.role, m.businessType) })
    }
    return ok({ kind: 'choose', companies: matches.map((m) => ({ slug: m.slug, name: m.name })) })
  } catch (error) {
    logError('api/auth/resolve-login', error)
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
