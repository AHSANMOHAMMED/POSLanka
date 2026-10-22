import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { staffInvites, tenants, accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { consumeRateLimit, clientIp } from '@/lib/auth/rate-limit'

// Rate limiting per client IP (database-backed, shared by all instances): 10 lookups per minute.
// Keyed by IP rather than token prefix — every guessed token has a different prefix, so a
// token-keyed limit never slowed enumeration down.
const INVITE_LOOKUP_RATE_LIMIT = { maxAttempts: 10, windowMs: 60 * 1000, category: 'invite_lookup' }
const MIN_RESPONSE_TIME = 100 // Minimum response time in ms to prevent timing attacks

// GET /api/invites/[token] - Get invite details (public)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const startTime = Date.now()

  try {
    const { token } = await params

    // Rate limiting by client IP to prevent token enumeration
    if ((await consumeRateLimit(clientIp(request), INVITE_LOOKUP_RATE_LIMIT)).limited) {
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise(resolve => setTimeout(resolve, MIN_RESPONSE_TIME - elapsed))
      }
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
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
