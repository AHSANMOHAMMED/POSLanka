import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { revokeAllSessions } from '@/lib/auth/session-manager'
import { checkRateLimit, recordRateLimitAttempt, RESET_PASSWORD_RATE_LIMIT } from '@/lib/auth/rate-limit'
import { validateBody } from '@/lib/validation'
import { resetPasswordSchema } from '@/lib/validation/schemas/auth'

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

    // Record this attempt
    await recordRateLimitAttempt(ip, RESET_PASSWORD_RATE_LIMIT)

    const parsed = await validateBody(request, resetPasswordSchema)
    if (!parsed.success) return parsed.response

    const { token, newPassword } = parsed.data

    // Verify the JWT token
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET not configured')
    }

    let payload: { accountId?: string; email?: string; purpose?: string }
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
    if (payload.purpose !== 'password-reset' || !payload.accountId || !payload.email) {
      return NextResponse.json(
        { error: 'Invalid reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    // Look up the account
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, payload.accountId),
    })

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found. Please request a new reset link.' },
        { status: 400 }
      )
    }

    // Verify the email matches
    if (account.email !== payload.email) {
      return NextResponse.json(
        { error: 'Invalid reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 12)

    // Update the account's password and record the change time
    await db.update(accounts)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(eq(accounts.id, account.id))

    // Revoke ALL sessions (password was reset, no current session to keep)
    revokeAllSessions(account.id, undefined, 'password_reset')
      .catch(err => console.error('[ResetPassword] Failed to revoke sessions:', err))

    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    })
  } catch (error) {
    logError('api/auth/reset-password', error)
    return NextResponse.json(
      { error: 'Failed to reset password. Please try again.' },
      { status: 500 }
    )
  }
}
