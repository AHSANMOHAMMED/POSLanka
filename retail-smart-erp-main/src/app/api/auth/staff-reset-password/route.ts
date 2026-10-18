import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db, withTenant } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { revokeAllSessions } from '@/lib/auth/session-manager'
import { checkRateLimit, recordRateLimitAttempt, RESET_PASSWORD_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { validateBody } from '@/lib/validation'
import { staffResetPasswordSchema } from '@/lib/validation/schemas/auth'

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    // Database-backed rate limiting by IP
    const rateLimitResult = await checkRateLimit(ip, RESET_PASSWORD_RATE_LIMIT)
    if (rateLimitResult.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 }
      )
    }

    await recordRateLimitAttempt(ip, RESET_PASSWORD_RATE_LIMIT)

    const parsed = await validateBody(request, staffResetPasswordSchema)
    if (!parsed.success) return parsed.response

    const { token, newPassword } = parsed.data

    // Verify the JWT token
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET not configured')
    }

    let payload: { userId?: string; email?: string; tenantId?: string; purpose?: string }
    try {
      const result = await jwtVerify(token, new TextEncoder().encode(secret))
      payload = result.payload as typeof payload
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    // Validate token purpose
    if (payload.purpose !== 'staff-password-reset' || !payload.userId || !payload.email || !payload.tenantId) {
      return NextResponse.json(
        { error: 'Invalid reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    // Look up the user via RLS
    const user = await withTenant(payload.tenantId, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.id, payload.userId!),
          eq(users.isActive, true)
        ),
      })
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found. Please request a new reset link.' },
        { status: 400 }
      )
    }

    // Verify the email matches
    if (user.email !== payload.email) {
      return NextResponse.json(
        { error: 'Invalid reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 12)

    // Update the user's password and record the change time
    await withTenant(payload.tenantId, async (tdb) => {
      return tdb.update(users)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(eq(users.id, user.id))
    })

    // Revoke all sessions if user has an accountId
    if (user.accountId) {
      revokeAllSessions(user.accountId, undefined, 'staff_password_reset')
        .catch(err => console.error('[StaffResetPassword] Failed to revoke sessions:', err))
    }

    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    })
  } catch (error) {
    logError('api/auth/staff-reset-password', error)
    return NextResponse.json(
      { error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    )
  }
}
