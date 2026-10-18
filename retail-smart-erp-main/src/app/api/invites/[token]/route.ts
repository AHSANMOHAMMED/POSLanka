import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { staffInvites, tenants, accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// Rate limiting map: IP/token -> { count, firstRequest }
const rateLimitMap = new Map<string, { count: number; firstRequest: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 10 // Max 10 requests per minute
const MIN_RESPONSE_TIME = 100 // Minimum response time in ms to prevent timing attacks
let inviteLastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// GET /api/invites/[token] - Get invite details (public)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const startTime = Date.now()

  try {
    const { token } = await params

    // Periodically clean expired entries to prevent memory leaks
    const now = Date.now()
    if (now - inviteLastCleanup > CLEANUP_INTERVAL) {
      inviteLastCleanup = now
      for (const [key, entry] of rateLimitMap) {
        if (now - entry.firstRequest > RATE_LIMIT_WINDOW) rateLimitMap.delete(key)
      }
    }

    // Rate limiting by token to prevent enumeration
    const rateLimitKey = `token:${token.substring(0, 8)}` // Only use first 8 chars to group similar attempts
    const rateLimit = rateLimitMap.get(rateLimitKey)

    if (rateLimit) {
      if (now - rateLimit.firstRequest < RATE_LIMIT_WINDOW) {
        if (rateLimit.count >= RATE_LIMIT_MAX) {
          const elapsed = Date.now() - startTime
          if (elapsed < MIN_RESPONSE_TIME) {
            await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
          }
          return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
        }
        rateLimit.count++
      } else {
        rateLimitMap.set(rateLimitKey, { count: 1, firstRequest: now })
      }
    } else {
      rateLimitMap.set(rateLimitKey, { count: 1, firstRequest: now })
    }

    // Find invite
    const invite = await db.query.staffInvites.findFirst({
      where: eq(staffInvites.token, token),
    })

    if (!invite) {
      // Use generic error message to prevent token enumeration
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
      }
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 404 })
    }

    // Check if already accepted
    if (invite.acceptedAt) {
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
      }
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
    }

    // Check if expired
    if (new Date(invite.expiresAt) < new Date()) {
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
      }
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 })
    }

    // Get inviter details
    let inviterName = 'Someone'
    if (invite.invitedBy) {
      const inviter = await db.query.accounts.findFirst({
        where: eq(accounts.id, invite.invitedBy),
      })
      if (inviter) {
        inviterName = inviter.fullName
      }
    }

    // Get tenant details
    const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
    const tenantDetails = await Promise.all(
      assignments.map(async (a) => {
        const tenant = await db.query.tenants.findFirst({
          where: eq(tenants.id, a.tenantId),
        })
        return {
          tenantId: a.tenantId,
          tenantName: tenant?.name || 'Unknown Company',
          tenantSlug: tenant?.slug,
          businessType: tenant?.businessType,
          role: a.role,
        }
      })
    )

    // Check if user already has an account
    const existingAccount = await db.query.accounts.findFirst({
      where: eq(accounts.email, invite.email),
    })

    // Mask email to reduce enumeration risk while still showing it's for the right person
    // e.g., "john.doe@example.com" -> "j***@example.com"
    const emailParts = invite.email.split('@')
    const localPart = emailParts[0]
    const domain = emailParts[1]
    const maskedLocal = localPart.length > 2
      ? localPart[0] + '***' + localPart[localPart.length - 1]
      : localPart[0] + '***'
    const maskedEmail = `${maskedLocal}@${domain}`

    // Ensure consistent response time
    const elapsed = Date.now() - startTime
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
    }

    return NextResponse.json({
      email: maskedEmail,
      invitedBy: inviterName,
      expiresAt: invite.expiresAt,
      tenantAssignments: tenantDetails,
      hasExistingAccount: !!existingAccount,
    })
  } catch (error) {
    logError('api/invites/[token]', error)
    const elapsed = Date.now() - startTime
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
