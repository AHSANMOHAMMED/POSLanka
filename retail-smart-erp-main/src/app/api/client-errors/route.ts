import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { aiErrorLogs } from '@/lib/db/schema'
import { sql, and, gte, eq } from 'drizzle-orm'
import crypto from 'crypto'
import { validateBody } from '@/lib/validation/helpers'
import { clientErrorsSchema } from '@/lib/validation/schemas/public'

interface ClientError {
  message: string
  stack?: string
  url: string
  componentStack?: string
  timestamp: number
}

// Rate limit: max 50 errors per tenant per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
let lastCleanup = Date.now()

function checkRateLimit(key: string): boolean {
  const now = Date.now()

  // Periodically clean expired entries (every 10 min)
  if (now - lastCleanup > 600_000) {
    lastCleanup = now
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k)
    }
  }

  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 3600_000 })
    return true
  }
  if (entry.count >= 50) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    const tenantId = session?.user?.tenantId || null
    const userId = session?.user?.id || null

    // Rate limit by tenant or IP
    const rateLimitKey = tenantId || request.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const parsed = await validateBody(request, clientErrorsSchema)
    if (!parsed.success) return parsed.response
    const { errors, userAgent, browserInfo } = parsed.data

    const batch = errors as ClientError[]
    let logged = 0

    for (const error of batch) {
      if (!error.message) continue

      // Generate fingerprint for dedup
      const firstFrame = error.stack?.split('\n').find((l: string) => l.trim().startsWith('at '))?.trim() || ''
      const normalized = error.message
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
        .replace(/\b\d+\b/g, '<N>')
      const fingerprint = crypto
        .createHash('sha256')
        .update(`frontend:${normalized}:${firstFrame}`)
        .digest('hex')
        .slice(0, 32)

      // Try dedup: increment if same fingerprint exists in last 24h
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [existing] = await db
        .update(aiErrorLogs)
        .set({
          occurrenceCount: sql`COALESCE(${aiErrorLogs.occurrenceCount}, 1) + 1`,
          lastOccurredAt: new Date(),
        })
        .where(and(
          eq(aiErrorLogs.errorFingerprint, fingerprint),
          gte(aiErrorLogs.createdAt, twentyFourHoursAgo),
        ))
        .returning({ id: aiErrorLogs.id })

      if (existing) {
        logged++
        continue
      }

      // Insert new entry
      const stack = error.componentStack
        ? `${error.stack || ''}\n\nComponent Stack:\n${error.componentStack}`
        : error.stack || null

      await db.insert(aiErrorLogs).values({
        tenantId,
        level: 'error',
        source: 'frontend',
        message: error.message.slice(0, 2000),
        stack,
        errorSource: 'frontend',
        reportedUrl: error.url || null,
        userAgent: userAgent || null,
        browserInfo: browserInfo || null,
        errorFingerprint: fingerprint,
        occurrenceCount: 1,
        lastOccurredAt: new Date(),
        context: userId ? { userId } : null,
      })
      logged++
    }

    return NextResponse.json({ logged })
  } catch {
    // Don't log errors about logging errors — avoid infinite loops
    return NextResponse.json({ error: 'Failed to log errors' }, { status: 500 })
  }
}
