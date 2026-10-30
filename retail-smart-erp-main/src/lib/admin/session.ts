import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adminSessions, superAdmins } from '@/lib/db/schema'
import { and, eq, gte, lt, like, notLike } from 'drizzle-orm'
import { headers, cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { adminCan, adminDeniedMessage, normalizeAdminRole, type AdminPermission, type AdminRole } from './roles'

// Admin session timeout: 15 minutes of inactivity
const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const SESSION_COOKIE_NAME = 'admin_session'

export interface AdminSession {
  id: string
  superAdminId: string
  sessionToken: string
  lastActivityAt: Date
  expiresAt: Date
  /** Platform role of the signed-in admin (super_admins.role) */
  role: AdminRole
}

/**
 * Create a new admin session for a super admin
 */
export async function createAdminSession(superAdminId: string, options: { setCookie?: boolean } = {}): Promise<string> {
  const headersList = await headers()
  const forwardedFor = headersList.get('x-forwarded-for')
  const realIp = headersList.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
  const userAgent = headersList.get('user-agent') || undefined

  const sessionToken = (options.setCookie === false ? 'sa_' : '') + randomBytes(32).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS)

  // Invalidate existing sessions for this super admin on the SAME channel only:
  // a mobile (bearer, `sa_` prefix) login must not log out the web console and vice versa.
  const isBearer = options.setCookie === false
  await db.delete(adminSessions)
    .where(and(
      eq(adminSessions.superAdminId, superAdminId),
      isBearer ? like(adminSessions.sessionToken, 'sa\\_%') : notLike(adminSessions.sessionToken, 'sa\\_%'),
    ))

  // Create new session
  await db.insert(adminSessions).values({
    superAdminId,
    sessionToken,
    ipAddress,
    userAgent,
    lastActivityAt: now,
    expiresAt,
  })

  // Set cookie (skipped for bearer/mobile sessions)
  if (options.setCookie === false) return sessionToken
  const cookieStore = await cookies()
  const isHttps = (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false) ||
    headersList.get('x-forwarded-proto') === 'https' ||
    process.env.COOKIE_SECURE === 'true'

  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: SESSION_TIMEOUT_MS / 1000,
    path: '/',
  })

  return sessionToken
}

/**
 * Validate admin session (read-only, for Server Components)
 * Returns the session if valid, null if invalid/expired
 * Does NOT refresh the cookie - use validateAdminSessionWithRefresh for Route Handlers
 */
/** Session token from the admin cookie, or `Authorization: Bearer <token>` (mobile companion app). */
async function readAdminToken(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (fromCookie) return fromCookie
  try {
    const h = await headers()
    const auth = h.get('authorization')
    if (auth?.startsWith('Bearer sa_')) return auth.slice(7)
  } catch {
    // headers() unavailable outside a request
  }
  return undefined
}

export interface AdminSessionOptions {
  /** What the caller is about to do (see src/lib/admin/roles.ts). */
  permission: AdminPermission
  /**
   * Allow an admin whose account setup is pending (password change forced by another admin,
   * or required 2FA not enrolled yet). Only the endpoints that complete the setup pass this:
   * change own password, 2FA setup/verify, logout and the console layout that shows the gate.
   */
  allowPendingSetup?: boolean
}

/**
 * What a route needs: a permission name, or the permission plus options. Required on every call
 * so a sys-control route cannot forget to state it (TypeScript refuses the call otherwise).
 */
export type AdminNeed = AdminPermission | AdminSessionOptions

function needOf(need: AdminNeed): AdminSessionOptions {
  return typeof need === 'string' ? { permission: need } : need
}

/** Account setup another admin requires before this admin may use the console / API. */
export interface PendingSetup {
  mustChangePassword: boolean
  totpRequired: boolean
}

function pendingSetupOf(a: { mustChangePassword: boolean; totpRequired: boolean; totpEnabled: boolean }): PendingSetup | null {
  const needTotp = a.totpRequired && !a.totpEnabled
  return a.mustChangePassword || needTotp ? { mustChangePassword: a.mustChangePassword, totpRequired: needTotp } : null
}

/** Live session row + the admin's state, or null (no/expired/idle session, deactivated admin). */
async function loadSession(sessionToken: string, now: Date) {
  const [row] = await db.select({
    session: adminSessions,
    isActive: superAdmins.isActive,
    mustChangePassword: superAdmins.mustChangePassword,
    totpRequired: superAdmins.totpRequired,
    totpEnabled: superAdmins.totpEnabled,
    role: superAdmins.role,
  })
    .from(adminSessions)
    .innerJoin(superAdmins, eq(superAdmins.id, adminSessions.superAdminId))
    .where(and(eq(adminSessions.sessionToken, sessionToken), gte(adminSessions.expiresAt, now)))
    .limit(1)
  if (!row || !row.isActive) return null
  return { session: { ...row.session, role: normalizeAdminRole(row.role) } as AdminSession, pending: pendingSetupOf(row) }
}

/**
 * Validate admin session (read-only, for Server Components and Route Handlers).
 * Returns the session if valid, null if invalid/expired/idle, the admin is deactivated, or —
 * unless `allowPendingSetup` — the admin still has account setup pending (see adminAuthError()).
 */
export async function validateAdminSession(need: AdminNeed): Promise<AdminSession | null> {
  const options = needOf(need)
  const sessionToken = await readAdminToken()
  if (!sessionToken) return null

  const now = new Date()
  const found = await loadSession(sessionToken, now)
  if (!found) return null

  // Check if session has timed out due to inactivity
  const inactivityLimit = new Date(now.getTime() - SESSION_TIMEOUT_MS)
  if (found.session.lastActivityAt < inactivityLimit) return null

  if (found.pending && !options.allowPendingSetup) return null
  if (!adminCan(found.session.role, options.permission)) return null
  await slideSession(found.session, sessionToken, now)
  return found.session
}

/** Activity keeps the session alive (15 min idle limit, not 15 min after sign-in); written at most once a minute. */
async function slideSession(session: AdminSession, sessionToken: string, now: Date): Promise<void> {
  if (now.getTime() - new Date(session.lastActivityAt).getTime() < 60_000) return
  await db.update(adminSessions)
    .set({ lastActivityAt: now, expiresAt: new Date(now.getTime() + SESSION_TIMEOUT_MS) })
    .where(eq(adminSessions.id, session.id))
    .catch(() => undefined)
  if (sessionToken.startsWith('sa_')) return
  try {
    // Route handlers can refresh the cookie; Server Components cannot set cookies (ignored there)
    const isHttps = (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false) || process.env.COOKIE_SECURE === 'true'
    ;(await cookies()).set(SESSION_COOKIE_NAME, sessionToken, { httpOnly: true, secure: isHttps, sameSite: 'lax', maxAge: SESSION_TIMEOUT_MS / 1000, path: '/' })
  } catch {
    /* read-only cookie store */
  }
}

/**
 * Setup still pending for the current (otherwise valid) admin session, or null.
 * Used to tell "finish your account setup" (403) apart from "not signed in" (401).
 */
export async function getPendingSetup(): Promise<PendingSetup | null> {
  const sessionToken = await readAdminToken()
  if (!sessionToken) return null
  const now = new Date()
  const found = await loadSession(sessionToken, now)
  if (!found || found.session.lastActivityAt < new Date(now.getTime() - SESSION_TIMEOUT_MS)) return null
  return found.pending
}

/** Role of the current (valid, not idle) admin session, or null. Ignores pending setup. */
async function currentRole(): Promise<AdminRole | null> {
  const sessionToken = await readAdminToken()
  if (!sessionToken) return null
  const now = new Date()
  const found = await loadSession(sessionToken, now)
  if (!found || found.session.lastActivityAt < new Date(now.getTime() - SESSION_TIMEOUT_MS)) return null
  return found.session.role
}

/** 403 for a signed-in admin whose role lacks the permission a route / action needs. */
export function adminForbidden(role: AdminRole | null | undefined): NextResponse {
  return NextResponse.json({ error: adminDeniedMessage(role), code: 'ROLE_FORBIDDEN', role: role ?? null }, { status: 403 })
}

/**
 * For handlers with several actions: null when the session's role may perform `permission`,
 * otherwise the 403 response to return.
 */
export function requireAdminPermission(session: Pick<AdminSession, 'role'>, ...permissions: AdminPermission[]): NextResponse | null {
  for (const p of permissions) if (!adminCan(session.role, p)) return adminForbidden(session.role)
  return null
}

/**
 * Response for a sys-control route whose validateAdminSession() returned null:
 * 403 { code: 'ACCOUNT_SETUP_REQUIRED' } when the admin is signed in but must first change
 * their password or enrol 2FA, 403 { code: 'ROLE_FORBIDDEN' } when the admin's role does not
 * allow the route, otherwise 401.
 */
export async function adminAuthError(): Promise<NextResponse> {
  const pending = await getPendingSetup().catch(() => null)
  if (pending) {
    return NextResponse.json({
      error: pending.mustChangePassword
        ? 'Choose a new password before using the console.'
        : 'Set up two-factor authentication before using the console.',
      code: 'ACCOUNT_SETUP_REQUIRED',
      setup: pending,
    }, { status: 403 })
  }
  const role = await currentRole().catch(() => null)
  if (role) return adminForbidden(role)
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * Validate and refresh admin session (for Route Handlers/Server Actions only)
 * Returns the session if valid, null if invalid/expired
 * Refreshes the cookie expiry on each valid access
 */
export async function validateAdminSessionWithRefresh(need: AdminNeed): Promise<AdminSession | null> {
  const options = needOf(need)
  const cookieStore = await cookies()
  const sessionToken = await readAdminToken()

  if (!sessionToken) {
    return null
  }

  const now = new Date()
  const found = await loadSession(sessionToken, now)

  if (!found) {
    // Clear invalid cookie
    cookieStore.delete(SESSION_COOKIE_NAME)
    return null
  }
  const session = found.session

  // Check if session has timed out due to inactivity
  const inactivityLimit = new Date(now.getTime() - SESSION_TIMEOUT_MS)
  if (session.lastActivityAt < inactivityLimit) {
    // Session timed out due to inactivity
    await destroyAdminSession(sessionToken)
    return null
  }

  if (found.pending && !options.allowPendingSetup) return null
  if (!adminCan(session.role, options.permission)) return null

  // Refresh session - update last activity and extend expiry
  const newExpiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS)
  await db.update(adminSessions)
    .set({
      lastActivityAt: now,
      expiresAt: newExpiresAt,
    })
    .where(eq(adminSessions.id, session.id))

  // Refresh cookie (web console only; bearer tokens carry no cookie)
  if (!sessionToken.startsWith('sa_')) {
    const isHttps = (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false) ||
      process.env.COOKIE_SECURE === 'true'
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: SESSION_TIMEOUT_MS / 1000,
      path: '/',
    })
  }

  return session
}

/**
 * Destroy admin session (logout)
 */
export async function destroyAdminSession(sessionToken?: string): Promise<void> {
  const cookieStore = await cookies()

  if (!sessionToken) {
    sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  }

  if (sessionToken) {
    await db.delete(adminSessions)
      .where(eq(adminSessions.sessionToken, sessionToken))
  }

  cookieStore.delete(SESSION_COOKIE_NAME)
}

/**
 * Get remaining session time in seconds
 */
export async function getSessionTimeRemaining(): Promise<number | null> {
  const session = await validateAdminSession({ permission: 'self', allowPendingSetup: true })
  if (!session) return null

  const now = new Date()
  const remaining = Math.max(0, session.expiresAt.getTime() - now.getTime())
  return Math.ceil(remaining / 1000)
}

/**
 * Clean up expired sessions (run periodically)
 */
export async function cleanupExpiredSessions(): Promise<void> {
  const now = new Date()
  await db.delete(adminSessions)
    .where(lt(adminSessions.expiresAt, now))
}

/**
 * Check if super admin has an active session
 */
export async function hasActiveAdminSession(superAdminId: string): Promise<boolean> {
  const now = new Date()
  const session = await db.query.adminSessions.findFirst({
    where: and(
      eq(adminSessions.superAdminId, superAdminId),
      gte(adminSessions.expiresAt, now)
    ),
  })
  return !!session
}

/**
 * Get super admin data from session
 */
export async function getAdminFromSession(): Promise<{
  id: string
  email: string
  fullName: string
  totpEnabled: boolean
  totpRequired: boolean
  mustChangePassword: boolean
  role: AdminRole
} | null> {
  // The console layout shows the setup gate, so a pending admin is let through here
  const session = await validateAdminSession({ permission: 'self', allowPendingSetup: true })
  if (!session) return null

  const admin = await db.query.superAdmins.findFirst({
    where: eq(superAdmins.id, session.superAdminId),
    columns: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      totpEnabled: true,
      totpRequired: true,
      mustChangePassword: true,
      role: true,
    },
  })

  // A deactivated admin's remaining session (if any) no longer opens the console
  if (!admin || !admin.isActive) return null
  const { isActive: _isActive, role, ...rest } = admin
  return { ...rest, role: normalizeAdminRole(role) }
}

/**
 * Authenticate super admin login
 * Returns admin data if successful, error if failed
 */
export async function authenticateSuperAdmin(email: string, password: string, ipAddress?: string): Promise<{
  success: boolean
  error?: string
  admin?: { id: string; email: string; fullName: string; role: AdminRole }
}> {
  const admin = await db.query.superAdmins.findFirst({
    where: eq(superAdmins.email, email.toLowerCase()),
  })

  if (!admin) {
    return { success: false, error: 'Invalid email or password' }
  }

  // Check if account is locked
  if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
    const remainingMinutes = Math.ceil((new Date(admin.lockedUntil).getTime() - Date.now()) / 60000)
    return { success: false, error: `Account locked. Try again in ${remainingMinutes} minutes.` }
  }

  // Check if account is active
  if (!admin.isActive) {
    return { success: false, error: 'Account is deactivated' }
  }

  // Verify password
  const isValid = await bcrypt.compare(password, admin.passwordHash)

  if (!isValid) {
    // Increment failed attempts
    const failedAttempts = admin.failedLoginAttempts + 1
    const updates: Record<string, unknown> = {
      failedLoginAttempts: failedAttempts,
      updatedAt: new Date(),
    }

    // Lock account after 5 failed attempts for 30 minutes
    if (failedAttempts >= 5) {
      updates.lockedUntil = new Date(Date.now() + 30 * 60 * 1000)
    }

    await db.update(superAdmins)
      .set(updates)
      .where(eq(superAdmins.id, admin.id))

    return { success: false, error: 'Invalid email or password' }
  }

  // Reset failed attempts and update login info
  await db.update(superAdmins)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress || null,
      updatedAt: new Date(),
    })
    .where(eq(superAdmins.id, admin.id))

  return {
    success: true,
    admin: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: normalizeAdminRole(admin.role),
    },
  }
}
