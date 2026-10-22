import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { checkEmailSchema } from '@/lib/validation/schemas/auth'
import { consumeRateLimit, clientIp, rateLimitedResponse } from '@/lib/auth/rate-limit'

// Rate limiting for email checks: 10 per minute per IP (database-backed, shared by all instances)
const CHECK_EMAIL_RATE_LIMIT = { maxAttempts: 10, windowMs: 60 * 1000, category: 'check_email' }

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const limit = await consumeRateLimit(clientIp(request), CHECK_EMAIL_RATE_LIMIT)
    if (limit.limited) return rateLimitedResponse(limit)

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
