import crypto from 'crypto'
import { db } from '@/lib/db'
import { accountSessions } from '@/lib/db/schema'
import { eq, and, lt, ne, or } from 'drizzle-orm'

// Session lifetime: 24 hours (DB record), JWT is 15 min (handled by NextAuth)
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000

interface CreateSessionOptions {
  /** Pre-generated session token (if not provided, one is generated) */
  sessionToken?: string
  ipAddress?: string
  userAgent?: string
  tenantId?: string
  tenantSlug?: string
}

/**
 * Create a new DB session record for a login.
 * Returns the session token (provided or generated).
 */
export async function createSession(
  accountId: string,
  scope: 'account' | 'company',
  opts: CreateSessionOptions = {}
): Promise<string> {
  const sessionToken = opts.sessionToken || crypto.randomBytes(32).toString('hex')
  const deviceName = opts.userAgent ? parseDeviceName(opts.userAgent) : 'Unknown Device'
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)

  await db.insert(accountSessions).values({
    accountId,
    sessionToken,
    scope,
    tenantId: opts.tenantId || null,
    tenantSlug: opts.tenantSlug || null,
    ipAddress: opts.ipAddress || null,
    userAgent: opts.userAgent || null,
    deviceName,
    expiresAt,
  })

  return sessionToken
}

/**
 * Validate a session token. Returns the session record if valid, null otherwise.
 * A session is valid if: exists, not revoked, not expired.
 */
export async function validateSession(sessionToken: string) {
  const session = await db.query.accountSessions.findFirst({
    where: and(
      eq(accountSessions.sessionToken, sessionToken),
      eq(accountSessions.isRevoked, false),
    ),
    columns: {
      id: true,
      accountId: true,
      scope: true,
      expiresAt: true,
      isRevoked: true,
    },
  })

  if (!session) return null

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    return null
  }

  return session
}

/**
 * Update the lastActivityAt timestamp on a session (called by heartbeat).
 * Also extends the expiry by SESSION_LIFETIME_MS from now.
 */
export async function touchSession(sessionToken: string): Promise<void> {
  const now = new Date()
  const newExpiry = new Date(now.getTime() + SESSION_LIFETIME_MS)

  await db.update(accountSessions)
    .set({
      lastActivityAt: now,
      expiresAt: newExpiry,
    })
    .where(
      and(
        eq(accountSessions.sessionToken, sessionToken),
        eq(accountSessions.isRevoked, false),
      )
    )
}

/**
 * Revoke a single session by its ID.
 */
export async function revokeSession(
  sessionId: string,
  reason: string = 'user_revoked'
): Promise<void> {
  await db.update(accountSessions)
    .set({
      isRevoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    })
    .where(eq(accountSessions.id, sessionId))
}

/**
 * Revoke all sessions for an account.
 * If exceptToken is provided, that session is kept alive (for "sign out others").
 */
export async function revokeAllSessions(
  accountId: string,
  exceptToken?: string,
  reason: string = 'user_revoked'
): Promise<void> {
  const conditions = [
    eq(accountSessions.accountId, accountId),
    eq(accountSessions.isRevoked, false),
  ]

  if (exceptToken) {
    conditions.push(ne(accountSessions.sessionToken, exceptToken))
  }

  await db.update(accountSessions)
    .set({
      isRevoked: true,
      revokedAt: new Date(),
      revokedReason: reason,
    })
    .where(and(...conditions))
}

/**
 * List all active (non-revoked, non-expired) sessions for an account.
 */
export async function listActiveSessions(accountId: string, currentToken?: string) {
  const now = new Date()
  const sessions = await db.query.accountSessions.findMany({
    where: and(
      eq(accountSessions.accountId, accountId),
      eq(accountSessions.isRevoked, false),
    ),
    columns: {
      id: true,
      sessionToken: true,
      scope: true,
      tenantSlug: true,
      ipAddress: true,
      deviceName: true,
      lastActivityAt: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: (s, { desc }) => [desc(s.lastActivityAt)],
  })

  // Filter out expired ones and strip session tokens (never expose to callers)
  return sessions
    .filter(s => new Date(s.expiresAt) > now)
    .map(({ sessionToken, ...rest }) => ({
      ...rest,
      isCurrent: currentToken ? sessionToken === currentToken : false,
    }))
}

/**
 * Delete sessions that have been expired for more than 7 days (cleanup).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const result = await db.delete(accountSessions)
    .where(
      or(
        // Expired + past retention
        lt(accountSessions.expiresAt, cutoff),
        // Revoked + past retention
        and(
          eq(accountSessions.isRevoked, true),
          lt(accountSessions.revokedAt, cutoff),
        ),
      )
    )
    .returning({ id: accountSessions.id })

  return result.length
}

/**
 * Parse a user-agent string into a human-readable device name.
 * e.g. "Chrome on Windows", "Safari on iPhone", "Firefox on macOS"
 */
export function parseDeviceName(userAgent: string): string {
  if (!userAgent) return 'Unknown Device'

  let browser = 'Unknown Browser'
  let os = 'Unknown OS'

  // Detect browser (order matters — more specific first)
  if (/Edg\//i.test(userAgent)) browser = 'Edge'
  else if (/OPR\//i.test(userAgent) || /Opera/i.test(userAgent)) browser = 'Opera'
  else if (/SamsungBrowser/i.test(userAgent)) browser = 'Samsung Browser'
  else if (/Firefox\//i.test(userAgent)) browser = 'Firefox'
  else if (/CriOS/i.test(userAgent)) browser = 'Chrome'
  else if (/Chrome\//i.test(userAgent)) browser = 'Chrome'
  else if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari'
  else if (/MSIE|Trident/i.test(userAgent)) browser = 'Internet Explorer'

  // Detect OS
  if (/iPhone/i.test(userAgent)) os = 'iPhone'
  else if (/iPad/i.test(userAgent)) os = 'iPad'
  else if (/Android/i.test(userAgent)) {
    os = /Mobile/i.test(userAgent) ? 'Android' : 'Android Tablet'
  }
  else if (/Windows/i.test(userAgent)) os = 'Windows'
  else if (/Macintosh|Mac OS X/i.test(userAgent)) os = 'macOS'
  else if (/Linux/i.test(userAgent)) os = 'Linux'
  else if (/CrOS/i.test(userAgent)) os = 'ChromeOS'

  return `${browser} on ${os}`
}
