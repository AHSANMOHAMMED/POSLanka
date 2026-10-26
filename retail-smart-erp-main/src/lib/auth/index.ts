import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { db, withTenant } from '@/lib/db'
import { users, tenants, accounts, accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit, LOGIN_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { getLiveCompanyUser, isAccountActive } from '@/lib/auth/live-user'
import { sessionValidationKey, getSessionValidation, setSessionValidation, deleteSessionValidation } from './session-validation-cache'
import { consumeImpersonationToken } from '@/lib/auth/impersonation-token'
import { findTenantByIdentifier } from '@/lib/tenant/business-id'
import { findLoginUser } from './login-identity'

// ---------------------------------------------------------------------------
// Brute-force rate limiter (database-backed)
// Tracks failed login attempts by email to prevent targeted brute-force attacks.
// Persists across server restarts and works with multiple instances.
// ---------------------------------------------------------------------------

/**
 * Check whether the given email is currently rate-limited.
 * Returns true if the request should be blocked.
 */
async function isRateLimited(email: string): Promise<boolean> {
  const result = await checkRateLimit(email, LOGIN_RATE_LIMIT)
  return result.limited
}

/**
 * Record a failed login attempt for the given email.
 */
async function recordFailedAttempt(email: string): Promise<void> {
  await recordRateLimitAttempt(email, LOGIN_RATE_LIMIT)
}

/**
 * Clear rate limit after successful login.
 */
async function clearLoginRateLimit(email: string): Promise<void> {
  await clearRateLimit(email, LOGIN_RATE_LIMIT.category)
}

// Determine cookie domain based on environment
const getCookieDomain = () => {
  if (process.env.NODE_ENV === 'production') {
    const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'poslanka.lk').split(':')[0]
    if (base === 'localhost' || base === '127.0.0.1' || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(base)) return undefined
    return `.${base}` // Share cookies across all subdomains
  }
  return undefined // Local development: no domain restriction
}

const isSecureAuthCookie = () => {
  if (process.env.COOKIE_SECURE === 'true') return true
  if (process.env.COOKIE_SECURE === 'false') return false
  return (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false)
}


export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        tenantSlug: { label: 'Tenant', type: 'text' },
        businessId: { label: 'Business ID', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = (credentials.email as string).toLowerCase().trim()
        const password = credentials.password as string
        const tenantSlug = (credentials.tenantSlug as string | undefined)?.trim()
        const rawBusinessId = (credentials.businessId as string | undefined)?.trim()

        if (!tenantSlug && !rawBusinessId) {
          // Company auth requires tenantSlug or businessId
          return null
        }

        // Extract IP and user-agent from request for session tracking
        const reqIp = request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
          || request?.headers?.get?.('x-real-ip')
          || 'unknown'
        const reqUserAgent = request?.headers?.get?.('user-agent') || 'unknown'

        // --- Brute-force protection: check rate limit before any DB work ---
        if (await isRateLimited(email)) {
          console.warn('[Auth] Rate limited login attempt:', { email, tenantSlug, rawBusinessId })
          throw new Error('Too many failed login attempts. Please try again later.')
        }

        try {
          // Users-first flow: authenticate directly via users table
          // 1. Find tenant by slug or businessId
          // Business ID, web address or shop name (see findTenantByIdentifier)
          const tenant = await findTenantByIdentifier(rawBusinessId || tenantSlug!)

          if (!tenant) {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          if (tenant.status !== 'active') {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          if (tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date()) {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          // 2. Find the user by email or username (see findLoginUser)
          const user = await withTenant(tenant.id, (tdb) => findLoginUser(tdb, tenant, email))

          if (!user) {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          if (!user.isActive) {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          // Linked global account suspended by the platform admin
          if (user.accountId && !(await isAccountActive(user.accountId))) {
            throw new Error('Invalid credentials')
          }

          // 3. Validate password against users.passwordHash
          const isValidPassword = await bcrypt.compare(password, user.passwordHash)
          if (!isValidPassword) {
            await recordFailedAttempt(email)
            throw new Error('Invalid credentials')
          }

          // Authentication successful -- clear any prior failed attempts
          await clearLoginRateLimit(email)

          const now = new Date()

          // Update user last login and activity
          try {
            await withTenant(tenant.id, async (tdb) => {
              return tdb.update(users)
                .set({ lastLoginAt: now, lastActiveAt: now })
                .where(eq(users.id, user.id))
            })
          } catch {
            // Fallback: lastActiveAt column may not exist yet (pre-migration)
            await withTenant(tenant.id, async (tdb) => {
              return tdb.update(users)
                .set({ lastLoginAt: now })
                .where(eq(users.id, user.id))
            })
          }

          return {
            id: user.id,
            accountId: user.accountId || null,
            email: user.email,
            name: user.fullName,
            role: user.role,
            customRoleId: user.customRoleId || null,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            businessType: tenant.businessType,
            aiEnabled: tenant.aiEnabled,
            isSuperAdmin: user.isSuperAdmin,
            isOwner: user.role === 'owner',
            mode: 'company' as const,
            sessionToken: crypto.randomBytes(32).toString('hex'),
            _sessionMeta: { ip: reqIp, userAgent: reqUserAgent },
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error('[Auth] authorize() failed:', {
            email,
            tenantSlug,
            error: errorMessage,
          })
          return null
        }
      },
    }),
    // Transfer provider: allows account portal to create company sessions
    // via a short-lived signed token (no password needed)
    Credentials({
      id: 'transfer',
      name: 'transfer',
      credentials: {
        transferToken: { label: 'Transfer Token', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.transferToken) {
          return null
        }

        const transferToken = credentials.transferToken as string
        const secret = process.env.NEXTAUTH_SECRET
        if (!secret) {
          console.error('[Auth] NEXTAUTH_SECRET not configured for transfer token')
          return null
        }

        try {
          // Verify the transfer token
          const payload = jwt.verify(transferToken, secret) as {
            accountId: string
            tenantSlug: string
            type: string
            ip?: string
            userAgent?: string
          }

          if (payload.type !== 'company-transfer') {
            throw new Error('Invalid token type')
          }

          const { accountId, tenantSlug } = payload

          // Verify account exists
          const account = await db.query.accounts.findFirst({
            where: eq(accounts.id, accountId),
          })
          if (!account || account.isActive === false) {
            throw new Error('Account not found')
          }

          // Verify tenant
          const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.slug, tenantSlug),
          })
          if (!tenant || tenant.status !== 'active') {
            throw new Error('Company not found or inactive')
          }

          // Verify membership
          const membership = await db.query.accountTenants.findFirst({
            where: and(
              eq(accountTenants.accountId, accountId),
              eq(accountTenants.tenantId, tenant.id),
              eq(accountTenants.isActive, true)
            ),
          })
          if (!membership) {
            throw new Error('No access to this company')
          }

          // Find or create user record
          let user = await withTenant(tenant.id, async (tdb) => {
            return tdb.query.users.findFirst({
              where: and(
                eq(users.accountId, accountId),
                eq(users.tenantId, tenant.id)
              ),
            })
          })

          if (!user) {
            const [newUser] = await withTenant(tenant.id, async (tdb) => {
              return tdb.insert(users).values({
                tenantId: tenant.id,
                accountId: accountId,
                email: account.email,
                fullName: account.fullName || account.email.split('@')[0],
                passwordHash: account.passwordHash || '',
                role: membership.role,
                isActive: true,
                isSuperAdmin: false,
              }).returning()
            })
            user = newUser
          }

          // The company's users row is authoritative for access: an owner deactivating or
          // re-roling a staff member updates users, so the portal transfer must honour it.
          if (!user.isActive) {
            throw new Error('User is deactivated in this company')
          }

          // Update last login on account and user records
          const now = new Date()
          await db.update(accounts)
            .set({ lastLoginAt: now, lastActiveAt: now })
            .where(eq(accounts.id, accountId))

          // Update user's lastActiveAt so /api/auth/validate doesn't
          // reject the brand-new session for inactivity
          await withTenant(tenant.id, async (tdb) => {
            return tdb.update(users)
              .set({ lastActiveAt: now })
              .where(eq(users.id, user.id))
          })

          // Extract IP/UA: prefer transfer token payload, fallback to request headers
          const transferIp = payload.ip
            || request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
            || 'unknown'
          const transferUA = payload.userAgent
            || request?.headers?.get?.('user-agent')
            || 'unknown'

          return {
            id: user.id,
            accountId: account.id,
            email: account.email,
            name: account.fullName,
            role: user.role,
            customRoleId: user.customRoleId || membership.customRoleId || null,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            businessType: tenant.businessType,
            aiEnabled: tenant.aiEnabled,
            isSuperAdmin: user.isSuperAdmin || false,
            isOwner: membership.isOwner,
            mode: 'company' as const,
            sessionToken: crypto.randomBytes(32).toString('hex'),
            _sessionMeta: { ip: transferIp, userAgent: transferUA },
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error('[Auth] transfer authorize() failed:', errorMessage)
          return null
        }
      },
    }),
    // Super Admin impersonation: short-lived signed token → company owner session
    Credentials({
      id: 'impersonate',
      name: 'impersonate',
      credentials: {
        impersonateToken: { label: 'Impersonate Token', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.impersonateToken) return null
        const secret = process.env.NEXTAUTH_SECRET
        if (!secret) return null

        try {
          const ip =
            request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ||
            request?.headers?.get?.('x-real-ip') ||
            'unknown'
          // Verifies the signature and burns the link's jti atomically: each link works once
          const payload = await consumeImpersonationToken(credentials.impersonateToken as string, ip)
          if (!payload) {
            throw new Error('Invalid, expired or already used impersonation link')
          }

          const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.id, payload.tenantId),
          })
          if (!tenant || tenant.status !== 'active') {
            throw new Error('Vendor not found or inactive')
          }

          const ownerUser = await withTenant(tenant.id, async (tdb) => {
            return tdb.query.users.findFirst({
              where: and(eq(users.tenantId, tenant.id), eq(users.role, 'owner'), eq(users.isActive, true)),
            })
          })
          if (!ownerUser) {
            throw new Error('No active owner for this vendor')
          }

          const userAgent = request?.headers?.get?.('user-agent') || 'unknown'

          return {
            id: ownerUser.id,
            accountId: ownerUser.accountId || null,
            email: ownerUser.email,
            name: ownerUser.fullName,
            role: ownerUser.role,
            customRoleId: ownerUser.customRoleId || null,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            businessType: tenant.businessType,
            aiEnabled: tenant.aiEnabled,
            isSuperAdmin: false,
            isOwner: true,
            mode: 'company' as const,
            sessionToken: crypto.randomBytes(32).toString('hex'),
            impersonating: true,
            impersonatedByAdminId: payload.adminId,
            impersonatedByAdminEmail: payload.adminEmail || null,
            _sessionMeta: { ip, userAgent },
          }
        } catch (error) {
          console.error('[Auth] impersonate authorize() failed:', error instanceof Error ? error.message : error)
          return null
        }
      },
    }),
  ],
  cookies: {
    sessionToken: {
      name: 'company-session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureAuthCookie(),
        domain: getCookieDomain(),
      }
    },
    callbackUrl: {
      name: 'company-auth.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureAuthCookie(),
        domain: getCookieDomain(),
      }
    },
    csrfToken: {
      name: 'company-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureAuthCookie(),
        domain: getCookieDomain(),
      }
    },
    pkceCodeVerifier: {
      name: 'company-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureAuthCookie(),
        domain: getCookieDomain(),
        maxAge: 60 * 15,
      }
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        // Sign-in time in ms (iat is whole seconds and is re-issued on refresh)
        token.authAt = Date.now()
        token.accountId = user.accountId
        token.role = user.role
        token.customRoleId = user.customRoleId || null
        token.impersonating = Boolean((user as { impersonating?: boolean }).impersonating)
        token.impersonatedByAdminId = (user as { impersonatedByAdminId?: string }).impersonatedByAdminId
        token.impersonatedByAdminEmail = (user as { impersonatedByAdminEmail?: string | null }).impersonatedByAdminEmail
        token.tenantId = user.tenantId
        token.tenantSlug = user.tenantSlug
        token.tenantName = user.tenantName
        token.businessType = user.businessType
        token.aiEnabled = user.aiEnabled
        token.isSuperAdmin = user.isSuperAdmin
        token.isOwner = user.isOwner
        token.mode = 'company'
        token.invalid = false

        // Store session token for JWT tracking
        if (user.sessionToken) {
          token.sessionToken = user.sessionToken

          // Log login activity (fire-and-forget)
          if (user.tenantId && user.id) {
            const meta = (user as unknown as Record<string, unknown>)._sessionMeta as { ip: string; userAgent: string } | undefined
            import('@/lib/utils/activity-log').then(({ logActivity }) => {
              logActivity({
                tenantId: user.tenantId!,
                userId: user.id,
                action: 'login',
                entityType: 'session',
                description: 'Logged in',
                ipAddress: meta?.ip,
                userAgent: meta?.userAgent,
              })
            }).catch(() => {})
          }
        }
      }

      // Validate user and tenant. A successful check is reused for 20 s so clicks don't wait on
      // the database; staff/role/status changes clear the tenant's entries (session-validation-cache).
      const cacheKey = !user && token.tenantId && token.id
        ? sessionValidationKey(token.tenantId as string, token.id as string,
          typeof token.authAt === 'number' ? token.authAt : (token.iat as number | undefined))
        : null
      const cached = cacheKey ? getSessionValidation(cacheKey) : undefined
      if (cached) {
        token.logoUrl = cached.logoUrl
        token.aiEnabled = cached.aiEnabled
        token.invalid = false
      } else if (cacheKey && !user && token.tenantId && token.id) {
        const now = Date.now()
        try {
          // 1. Validate tenant is still active
          const tenant = await db.query.tenants.findFirst({
            where: and(
              eq(tenants.id, token.tenantId as string),
              eq(tenants.status, 'active')
            ),
            columns: { id: true, logoUrl: true, aiEnabled: true },
          })

          if (!tenant) {
            deleteSessionValidation(cacheKey)
            token.invalid = true
            return token
          }

          // 2. Validate user is still active, password unchanged since the token was issued,
          //    linked account not suspended — and pick up the CURRENT role so a demotion
          //    (e.g. manager → cashier) takes effect on the next request, not the next login.
          const live = await getLiveCompanyUser(
            token.tenantId as string,
            token.id as string,
            typeof token.iat === 'number' ? token.iat : undefined,
            typeof token.authAt === 'number' ? token.authAt : undefined,
          )
          if (!live.ok) {
            deleteSessionValidation(cacheKey)
            token.invalid = true
            return token
          }
          if (live.role !== token.role) {
            token.role = live.role
            token.isOwner = live.role === 'owner'
          }
          token.customRoleId = live.customRoleId

          token.logoUrl = tenant.logoUrl || undefined
          token.aiEnabled = tenant.aiEnabled
          token.invalid = false

          setSessionValidation(cacheKey, {
            validatedAt: now,
            logoUrl: tenant.logoUrl || undefined,
            aiEnabled: tenant.aiEnabled,
          })
        } catch (error) {
          console.error('[JWT] Session validation DB error (keeping session):', error)
        }
      }

      // Handle session updates (e.g., business type or tenant name changes)
      if (trigger === 'update' && session) {
        if (session.businessType !== undefined) {
          token.businessType = session.businessType
        }
        if (session.tenantName !== undefined) {
          token.tenantName = session.tenantName
        }
        if (session.aiEnabled !== undefined) {
          token.aiEnabled = session.aiEnabled
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (token.invalid) {
          session.user.id = ''
          session.user.accountId = null
          session.user.role = ''
          session.user.tenantId = ''
          session.user.tenantSlug = ''
          session.user.tenantName = ''
          session.user.businessType = ''
          session.user.isSuperAdmin = false
          session.user.isOwner = false
          session.user.aiEnabled = false
          session.user.mode = 'company'
          return session
        }

        session.user.id = token.id as string
        session.user.accountId = token.accountId as string | null
        session.user.role = (token.role || '') as string
        session.user.customRoleId = (token.customRoleId || null) as string | null
        session.user.tenantId = (token.tenantId || '') as string
        session.user.tenantSlug = (token.tenantSlug || '') as string
        session.user.tenantName = (token.tenantName || '') as string
        session.user.businessType = (token.businessType || '') as string
        session.user.isSuperAdmin = token.isSuperAdmin as boolean
        session.user.isOwner = token.isOwner as boolean
        session.user.aiEnabled = token.aiEnabled as boolean
        session.user.mode = 'company'
        session.user.logoUrl = token.logoUrl as string | undefined
        session.user.avatarUrl = token.avatarUrl as string | undefined
        session.user.sessionToken = token.sessionToken as string | undefined
        session.user.impersonating = Boolean(token.impersonating)
        session.user.impersonatedByAdminId = token.impersonatedByAdminId as string | undefined
        session.user.impersonatedByAdminEmail = token.impersonatedByAdminEmail as string | null | undefined
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 15 * 60, // 15 minutes — auto-refreshed by SessionProvider refetchInterval
  },
})

// Type extensions for NextAuth
declare module 'next-auth' {
  interface User {
    id: string
    accountId: string | null
    role: string
    customRoleId?: string | null
    customRoleName?: string | null
    tenantId: string
    tenantSlug: string
    tenantName: string
    businessType: string
    aiEnabled: boolean
    isSuperAdmin: boolean
    isOwner: boolean
    mode: 'account' | 'company'
    logoUrl?: string
    avatarUrl?: string
    sessionToken?: string
    impersonating?: boolean
    impersonatedByAdminId?: string
    impersonatedByAdminEmail?: string | null
    _sessionMeta?: { ip: string; userAgent: string }
  }

  interface Session {
    user: User & {
      id: string
      accountId: string | null
      role: string
      customRoleId?: string | null
      customRoleName?: string | null
      tenantId: string
      tenantSlug: string
      tenantName: string
      businessType: string
      aiEnabled: boolean
      isSuperAdmin: boolean
      isOwner: boolean
      mode: 'account' | 'company'
      logoUrl?: string
      avatarUrl?: string
      sessionToken?: string
      impersonating?: boolean
      impersonatedByAdminId?: string
      impersonatedByAdminEmail?: string | null
    }
  }

  interface JWT {
    id: string
    accountId: string | null
    role: string
    customRoleId?: string | null
    customRoleName?: string | null
    tenantId: string
    tenantSlug: string
    tenantName: string
    businessType: string
    aiEnabled: boolean
    isSuperAdmin: boolean
    isOwner: boolean
    mode: 'account' | 'company'
    invalid?: boolean
    logoUrl?: string
    avatarUrl?: string
    sessionToken?: string
    impersonating?: boolean
    impersonatedByAdminId?: string
    impersonatedByAdminEmail?: string | null
  }
}

// Helper type for sessions with company context
export interface CompanySession {
  user: {
    id: string
    accountId: string | null
    email: string
    name: string
    role: string
    customRoleId?: string | null
    customRoleName?: string | null
    tenantId: string
    tenantSlug: string
    tenantName: string
    businessType: string
    aiEnabled: boolean
    isSuperAdmin: boolean
    isOwner: boolean
    mode: 'company'
    impersonating?: boolean
  }
}

/**
 * Get session with company context validation.
 * Returns null if user is not authenticated or not in company mode (empty tenantId).
 * Also accepts Authorization: Bearer <mobile JWT> from the Expo app.
 */
export async function authWithCompany(): Promise<CompanySession | null> {
  // H4: /api/v1 runs existing handlers under an API-key principal (see ./api-key-context).
  // Only set by withApiKey() for the duration of a v1 request; absent for every other request.
  const { getApiKeyPrincipal } = await import('./api-key-context')
  const apiPrincipal = getApiKeyPrincipal()
  if (apiPrincipal) return apiPrincipal.session

  const session = await auth()
  if (session?.user?.tenantId) {
    // Warm permission cache for tenant-specific overrides (non-blocking on error).
    // Also registers cache lookup functions with roles.ts (breaks static import chain to pg).
    try {
      const cache = await import('./permission-cache')
      const { registerPermissionOverrides } = await import('./roles')
      registerPermissionOverrides({
        getPermissionOverride: cache.getPermissionOverride,
        getCustomRolePermission: cache.getCustomRolePermission,
        getCustomRoleBaseRole: cache.getCustomRoleBaseRole,
      })
      await cache.warmPermissionCache(session.user.tenantId)
    } catch {
      // Cache warming failure is non-fatal — falls back to system defaults
    }
    return session as unknown as CompanySession
  }

  // Mobile bearer token fallback
  try {
    const { headers } = await import('next/headers')
    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const secret = process.env.NEXTAUTH_SECRET
      if (!secret) return null
      const token = authHeader.slice(7)
      const payload = jwt.verify(token, secret) as {
        type?: string
        sub: string
        tenantId: string
        tenantSlug: string
        tenantName: string
        businessType?: string
        aiEnabled?: boolean
        accountId?: string | null
        customRoleId?: string | null
        role: string
        email: string
        name?: string
      }
      if (payload.type !== 'mobile' || !payload.tenantId) return null

      // Mobile tokens live 12h: re-check the user on every request so deactivation, a
      // password change or a demotion takes effect immediately (role comes from the DB).
      const live = await getLiveCompanyUser(payload.tenantId, payload.sub, (payload as { iat?: number }).iat, (payload as { authAt?: number }).authAt)
      if (!live.ok) return null
      payload.role = live.role
      payload.customRoleId = live.customRoleId

      // Prefer live tenant fields when available
      let businessType = payload.businessType || 'retail'
      let aiEnabled = Boolean(payload.aiEnabled)
      try {
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, payload.tenantId),
          columns: { businessType: true, aiEnabled: true, status: true },
        })
        if (!tenant || tenant.status !== 'active') return null
        businessType = tenant.businessType
        aiEnabled = tenant.aiEnabled
      } catch {
        // keep token claims
      }

      try {
        const cache = await import('./permission-cache')
        const { registerPermissionOverrides } = await import('./roles')
        registerPermissionOverrides({
          getPermissionOverride: cache.getPermissionOverride,
          getCustomRolePermission: cache.getCustomRolePermission,
          getCustomRoleBaseRole: cache.getCustomRoleBaseRole,
        })
        await cache.warmPermissionCache(payload.tenantId)
      } catch {
        // non-fatal
      }

      return {
        user: {
          id: payload.sub,
          accountId: payload.accountId || null,
          email: payload.email,
          name: payload.name || payload.email,
          role: payload.role,
          customRoleId: payload.customRoleId || null,
          tenantId: payload.tenantId,
          tenantSlug: payload.tenantSlug,
          tenantName: payload.tenantName,
          businessType,
          aiEnabled,
          isSuperAdmin: false,
          isOwner: payload.role === 'owner',
          mode: 'company',
        },
      }
    }
  } catch {
    return null
  }

  return null
}

// Re-export user ID resolution utilities
export { resolveUserId, resolveUserIdRequired } from './resolve-user'
