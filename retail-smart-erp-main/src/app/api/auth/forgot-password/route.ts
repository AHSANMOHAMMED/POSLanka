import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendSystemEmail } from '@/lib/email/system-email'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { forgotPasswordSchema } from '@/lib/validation/schemas/auth'

// Rate limiting: max 3 requests per email per hour (in-memory)
const forgotAttempts = new Map<string, { count: number; resetAt: number }>()
const FORGOT_LIMIT = 3
const FORGOT_WINDOW = 60 * 60 * 1000 // 1 hour
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// Always return success to prevent email enumeration
const SUCCESS_RESPONSE = {
  success: true,
  message: 'If an account exists with that email, we\'ve sent password reset instructions.',
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, forgotPasswordSchema)
    if (!parsed.success) return parsed.response
    const { email: normalizedEmail } = parsed.data

    const now = Date.now()

    // Periodically clean expired entries to prevent memory leaks
    if (now - lastCleanup > CLEANUP_INTERVAL) {
      lastCleanup = now
      for (const [key, entry] of forgotAttempts) {
        if (now > entry.resetAt) forgotAttempts.delete(key)
      }
    }

    // Rate limit by email
    const attempts = forgotAttempts.get(normalizedEmail)
    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= FORGOT_LIMIT) {
          // Still return success to prevent enumeration, but don't send email
          return NextResponse.json(SUCCESS_RESPONSE)
        }
        attempts.count++
      } else {
        forgotAttempts.set(normalizedEmail, { count: 1, resetAt: now + FORGOT_WINDOW })
      }
    } else {
      forgotAttempts.set(normalizedEmail, { count: 1, resetAt: now + FORGOT_WINDOW })
    }

    // Look up the account
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.email, normalizedEmail),
    })

    // If no account found, return success anyway (prevent email enumeration)
    if (!account) {
      return NextResponse.json(SUCCESS_RESPONSE)
    }

    // Generate a JWT token for password reset
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET not configured')
    }

    const token = await new SignJWT({
      accountId: account.id,
      email: normalizedEmail,
      purpose: 'password-reset',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    // Build the reset URL
    const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const resetUrl = `${appUrl}/reset-password?token=${token}`

    // Send password reset email
    const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Retail Smart POS'

    await sendSystemEmail({
      to: normalizedEmail,
      subject: `Reset your password - ${appName}`,
      text: `Hi ${account.fullName},\n\nWe received a request to reset your password. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.\n\n- ${appName}`,
      html: (() => {
        // Escape user-provided name to prevent HTML injection
        const safeName = (account.fullName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        return `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${appName}</h1>
          </div>

          <!-- Body -->
          <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi ${safeName},</p>
            <p style="color: #64748b; font-size: 15px; margin: 0 0 28px 0;">
              We received a request to reset your password. Click the button below to choose a new password.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin-bottom: 28px;">
              <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 10px; text-decoration: none;">
                Reset Password
              </a>
            </div>

            <!-- Timer badge -->
            <div style="text-align: center; margin-bottom: 28px;">
              <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px;">
                Expires in 1 hour
              </span>
            </div>

            <!-- Divider -->
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

            <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">
              If you didn&rsquo;t request a password reset, no worries &mdash; just ignore this email. Your password will remain unchanged.
            </p>

            <!-- Fallback link -->
            <p style="color: #94a3b8; font-size: 12px; margin: 16px 0 0 0; line-height: 1.5; word-break: break-all;">
              If the button doesn&rsquo;t work, copy and paste this link into your browser:<br />
              <a href="${resetUrl}" style="color: #3b82f6; text-decoration: underline;">${resetUrl}</a>
            </p>
          </div>

          <!-- Footer -->
          <div style="text-align: center; padding: 20px 24px;">
            <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
            </p>
          </div>
        </div>
      `
      })(),
    })

    return NextResponse.json(SUCCESS_RESPONSE)
  } catch (error) {
    logError('api/auth/forgot-password', error)
    // Still return success to prevent information leakage
    return NextResponse.json(SUCCESS_RESPONSE)
  }
}
