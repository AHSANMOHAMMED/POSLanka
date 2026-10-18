import { db } from '@/lib/db'
import { adminRateLimits } from '@/lib/db/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

interface RateLimitConfig {
  windowMs: number     // Time window in milliseconds
  maxRequests: number  // Max requests per window
}

// Default: 30 requests per minute for admin endpoints
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
}

// Stricter limit for sensitive operations
export const STRICT_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
}

// Very strict for login attempts
export const LOGIN_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: Date
}

/**
 * Check rate limit for an IP address and endpoint
 */
export async function checkRateLimit(
  endpoint: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<RateLimitResult> {
  const headersList = await headers()
  const forwardedFor = headersList.get('x-forwarded-for')
  const realIp = headersList.get('x-real-ip')
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'

  const windowStart = new Date(Date.now() - config.windowMs)

  // Get current count for this IP and endpoint within the window
  const existing = await db.query.adminRateLimits.findFirst({
    where: and(
      eq(adminRateLimits.ipAddress, ipAddress),
      eq(adminRateLimits.endpoint, endpoint),
      gte(adminRateLimits.windowStart, windowStart)
    ),
  })

  if (existing) {
    // Increment existing counter
    const newCount = existing.requestCount + 1
    await db.update(adminRateLimits)
      .set({ requestCount: newCount })
      .where(eq(adminRateLimits.id, existing.id))

    const resetAt = new Date(existing.windowStart.getTime() + config.windowMs)

    return {
      success: newCount <= config.maxRequests,
      remaining: Math.max(0, config.maxRequests - newCount),
      resetAt,
    }
  }

  // Create new rate limit entry
  const now = new Date()
  await db.insert(adminRateLimits).values({
    ipAddress,
    endpoint,
    requestCount: 1,
    windowStart: now,
  })

  return {
    success: true,
    remaining: config.maxRequests - 1,
    resetAt: new Date(now.getTime() + config.windowMs),
  }
}

/**
 * Create a rate-limited response with proper headers
 */
export function rateLimitExceeded(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': result.resetAt.toISOString(),
        'Retry-After': Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString(),
      },
    }
  )
}

/**
 * Middleware helper - returns error response if rate limited, null if OK
 */
export async function withRateLimit(
  endpoint: string,
  config?: RateLimitConfig
): Promise<NextResponse | null> {
  const result = await checkRateLimit(endpoint, config)
  if (!result.success) {
    return rateLimitExceeded(result)
  }
  return null
}

/**
 * Clean up old rate limit entries (run periodically)
 */
export async function cleanupRateLimits(): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  await db.delete(adminRateLimits)
    .where(sql`${adminRateLimits.windowStart} < ${oneHourAgo}`)
}
