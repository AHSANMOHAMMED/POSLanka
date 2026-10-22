import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export interface RateLimitConfig {
  maxAttempts: number
  windowMs: number
  category: string
  /**
   * When the database cannot be reached: true = treat as limited (login, PIN — a brute-force
   * window must never open because the limiter is down), false/undefined = allow (fail open).
   */
  failClosed?: boolean
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
    // Database unavailable: fail closed for credential checks, open for everything else
    if (config.failClosed) return { limited: true, remaining: 0, retryAfterMs: 60_000 }
    return { limited: false, remaining: maxAttempts }
  }
}

/**
 * Count one request against `key` and report whether it exceeds the limit — a single atomic
 * upsert, so it is correct across app instances (unlike per-process Maps). Use for endpoints
 * that limit every request (lookups, forgot-password, contact form) rather than only failures.
 */
export async function consumeRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { maxAttempts, windowMs, category } = config
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)
  try {
    const result = await db.execute(sql`
      INSERT INTO rate_limit_attempts (key, category, attempts, first_attempt_at, updated_at)
      VALUES (${key}, ${category}, 1, ${now}, ${now})
      ON CONFLICT (key, category) DO UPDATE SET
        attempts = CASE WHEN rate_limit_attempts.first_attempt_at < ${windowStart}
          THEN 1 ELSE rate_limit_attempts.attempts + 1 END,
        first_attempt_at = CASE WHEN rate_limit_attempts.first_attempt_at < ${windowStart}
          THEN ${now} ELSE rate_limit_attempts.first_attempt_at END,
        locked_until = NULL,
        updated_at = ${now}
      RETURNING attempts, first_attempt_at
    `)
    const row = result.rows?.[0] as { attempts: number | string; first_attempt_at: Date | string } | undefined
    const attempts = Number(row?.attempts ?? 1)
    if (attempts > maxAttempts) {
      const first = row ? new Date(row.first_attempt_at).getTime() : now.getTime()
      return { limited: true, remaining: 0, retryAfterMs: Math.max(1000, first + windowMs - now.getTime()) }
    }
    return { limited: false, remaining: maxAttempts - attempts }
  } catch {
    if (config.failClosed) return { limited: true, remaining: 0, retryAfterMs: 60_000 }
    return { limited: false, remaining: maxAttempts }
  }
}

/** Client IP from proxy headers (first x-forwarded-for hop), for rate-limit keys. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || 'unknown'
  return request.headers.get('x-real-ip') || 'unknown'
}

/** Standard 429 body + Retry-After header. */
export function rateLimitedResponse(result: RateLimitResult, message = 'Too many requests. Please try again later.'): Response {
  const seconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 1000))
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(seconds) },
  })
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
 * Clean up expired rate limit entries (called by /api/cron/retention). Returns rows deleted.
 */
export async function cleanupRateLimits(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const res = await db.execute(sql`
    DELETE FROM rate_limit_attempts
    WHERE first_attempt_at < ${cutoff}
      AND (locked_until IS NULL OR locked_until < now())
  `)
  return res.rowCount ?? 0
}

// Pre-configured rate limit configs
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  category: 'login',
  failClosed: true,
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
