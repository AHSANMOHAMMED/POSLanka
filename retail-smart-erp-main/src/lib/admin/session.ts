import { db } from '@/lib/db'
import { adminSessions, superAdmins } from '@/lib/db/schema'
import { and, eq, gte, lt } from 'drizzle-orm'
import { headers, cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'

// Admin session timeout: 15 minutes of inactivity
const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes
const SESSION_COOKIE_NAME = 'admin_session'

interface AdminSession {
  id: string
  superAdminId: string
  sessionToken: string
  lastActivityAt: Date
  expiresAt: Date
}

/**
 * Create a new admin session for a super admin
 */
export async function createAdminSession(superAdminId: string): Promise<string> {
  const headersList = await headers()
  const forwardedFor = headersList.get('x-forwarded-for')
  const realIp = headersList.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
  const userAgent = headersList.get('user-agent') || undefined

  const sessionToken = randomBytes(32).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS)

  // Invalidate any existing sessions for this super admin
  await db.delete(adminSessions)
    .where(eq(adminSessions.superAdminId, superAdminId))

  // Create new session
  await db.insert(adminSessions).values({
    superAdminId,
    sessionToken,
    ipAddress,
    userAgent,
    lastActivityAt: now,
    expiresAt,
  })

  // Set cookie
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
export async function validateAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!sessionToken) {
    return null
  }

  const now = new Date()

  // Find valid session
  const session = await db.query.adminSessions.findFirst({
    where: and(
      eq(adminSessions.sessionToken, sessionToken),
      gte(adminSessions.expiresAt, now)
    ),
  })

  if (!session) {
    return null
  }

  // Check if session has timed out due to inactivity
  const inactivityLimit = new Date(now.getTime() - SESSION_TIMEOUT_MS)
  if (session.lastActivityAt < inactivityLimit) {
    return null
  }

  return session
}

/**
 * Validate and refresh admin session (for Route Handlers/Server Actions only)
 * Returns the session if valid, null if invalid/expired
 * Refreshes the cookie expiry on each valid access
 */
export async function validateAdminSessionWithRefresh(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!sessionToken) {
    return null
  }

  const now = new Date()

  // Find valid session
  const session = await db.query.adminSessions.findFirst({
    where: and(
      eq(adminSessions.sessionToken, sessionToken),
      gte(adminSessions.expiresAt, now)
    ),
  })

  if (!session) {
    // Clear invalid cookie
    cookieStore.delete(SESSION_COOKIE_NAME)
    return null
  }

  // Check if session has timed out due to inactivity
  const inactivityLimit = new Date(now.getTime() - SESSION_TIMEOUT_MS)
  if (session.lastActivityAt < inactivityLimit) {
    // Session timed out due to inactivity
    await destroyAdminSession(sessionToken)
    return null
  }

  // Refresh session - update last activity and extend expiry
  const newExpiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS)
  await db.update(adminSessions)
    .set({
      lastActivityAt: now,
      expiresAt: newExpiresAt,
    })
    .where(eq(adminSessions.id, session.id))

  // Refresh cookie
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TIMEOUT_MS / 1000,
    path: '/',
  })

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
  const session = await validateAdminSession()
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
} | null> {
  const session = await validateAdminSession()
  if (!session) return null

  const admin = await db.query.superAdmins.findFirst({
    where: eq(superAdmins.id, session.superAdminId),
    columns: {
      id: true,
      email: true,
      fullName: true,
    },
  })

  return admin || null
}

/**
 * Authenticate super admin login
 * Returns admin data if successful, error if failed
 */
export async function authenticateSuperAdmin(email: string, password: string, ipAddress?: string): Promise<{
  success: boolean
  error?: string
  admin?: { id: string; email: string; fullName: string }
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
    },
  }
}
