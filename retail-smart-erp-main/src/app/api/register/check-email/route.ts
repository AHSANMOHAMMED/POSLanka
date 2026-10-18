import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { checkEmailSchema } from '@/lib/validation/schemas/auth'

// Rate limiting for email checks
const checkEmailAttempts = new Map<string, { count: number; resetAt: number }>()
const CHECK_EMAIL_LIMIT = 10 // max attempts
const CHECK_EMAIL_WINDOW = 60 * 1000 // 1 minute
let checkEmailLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const now = Date.now()

    // Periodically clean expired entries to prevent memory leaks
    if (now - checkEmailLastCleanup > CLEANUP_INTERVAL) {
      checkEmailLastCleanup = now
      for (const [key, entry] of checkEmailAttempts) {
        if (now > entry.resetAt) checkEmailAttempts.delete(key)
      }
    }

    const attempts = checkEmailAttempts.get(ip)
    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= CHECK_EMAIL_LIMIT) {
          return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
        }
        attempts.count++
      } else {
        checkEmailAttempts.set(ip, { count: 1, resetAt: now + CHECK_EMAIL_WINDOW })
      }
    } else {
      checkEmailAttempts.set(ip, { count: 1, resetAt: now + CHECK_EMAIL_WINDOW })
    }

    const parsed = await validateBody(request, checkEmailSchema)
    if (!parsed.success) return parsed.response
    const { email } = parsed.data

    const existing = await db.query.accounts.findFirst({
      where: eq(accounts.email, email),
      columns: { id: true },
    })

    return NextResponse.json({ available: !existing })
  } catch {
    return NextResponse.json({ error: 'Failed to check email' }, { status: 500 })
  }
}
