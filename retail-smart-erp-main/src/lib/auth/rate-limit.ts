import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  category: string
}

interface RateLimitResult {
  limited: boolean
  remaining: number
  retryAfterMs?: number
}

/**
 * Database-backed rate limiter.
 * Persists across server restarts and works with multiple instances.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { maxAttempts, windowMs, category } = config
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)

  try {
    // Get or create rate limit entry
    const result = await db.execute(sql`
      SELECT attempts, first_attempt_at, locked_until
      FROM rate_limit_attempts
      WHERE key = ${key} AND category = ${category}
      LIMIT 1
    `)

    const entry = result.rows?.[0] as {
      attempts: number
      first_attempt_at: Date | string
      locked_until: Date | string | null
    } | undefined

    if (!entry) {
      // No entry — not limited
      return { limited: false, remaining: maxAttempts }
    }

    const firstAttempt = new Date(entry.first_attempt_at)
    const lockedUntil = entry.locked_until ? new Date(entry.locked_until) : null

    // Check if there's an active lockout
    if (lockedUntil && now < lockedUntil) {
      return {
        limited: true,
        remaining: 0,
        retryAfterMs: lockedUntil.getTime() - now.getTime(),
      }
    }

    // If the window has expired, not limited
    if (firstAttempt < windowStart) {
      return { limited: false, remaining: maxAttempts }
    }

    // Within window — check attempt count
    const attempts = Number(entry.attempts)
    if (attempts >= maxAttempts) {
      return {
        limited: true,
        remaining: 0,
        retryAfterMs: firstAttempt.getTime() + windowMs - now.getTime(),
      }
    }

    return { limited: false, remaining: maxAttempts - attempts }
  } catch {
    // If database is unavailable, fail open (don't block legitimate users)
    return { limited: false, remaining: maxAttempts }
  }
}

/**
 * Record a failed attempt for rate limiting.
 */
export async function recordRateLimitAttempt(
  key: string,
  config: RateLimitConfig
): Promise<void> {
  const { maxAttempts, windowMs, category } = config
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)

  try {
    // Upsert: insert or update the attempt counter
    await db.execute(sql`
      INSERT INTO rate_limit_attempts (key, category, attempts, first_attempt_at, updated_at)
      VALUES (${key}, ${category}, 1, ${now}, ${now})
      ON CONFLICT (key, category) DO UPDATE SET
        attempts = CASE
          WHEN rate_limit_attempts.first_attempt_at < ${windowStart}
            THEN 1
          ELSE rate_limit_attempts.attempts + 1
        END,
        first_attempt_at = CASE
          WHEN rate_limit_attempts.first_attempt_at < ${windowStart}
            THEN ${now}
          ELSE rate_limit_attempts.first_attempt_at
        END,
        locked_until = CASE
          WHEN rate_limit_attempts.first_attempt_at >= ${windowStart}
            AND rate_limit_attempts.attempts + 1 >= ${maxAttempts}
            THEN ${new Date(now.getTime() + windowMs)}
          WHEN rate_limit_attempts.first_attempt_at < ${windowStart}
            THEN NULL
          ELSE rate_limit_attempts.locked_until
        END,
        updated_at = ${now}
    `)
  } catch {
    // Fail silently — rate limiting is defense-in-depth, not critical path
  }
}

/**
 * Clear rate limit for a key (e.g., after successful login).
 */
export async function clearRateLimit(
  key: string,
  category: string
): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM rate_limit_attempts
      WHERE key = ${key} AND category = ${category}
    `)
  } catch {
    // Fail silently
  }
}

/**
 * Clean up expired rate limit entries (call periodically).
 */
export async function cleanupRateLimits(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
    await db.execute(sql`
      DELETE FROM rate_limit_attempts
      WHERE first_attempt_at < ${cutoff}
        AND (locked_until IS NULL OR locked_until < now())
    `)
  } catch {
    // Fail silently
  }
}

// Pre-configured rate limit configs
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  category: 'login',
}

export const RESET_PASSWORD_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  category: 'reset_password',
}

export const REGISTER_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  category: 'register',
}
