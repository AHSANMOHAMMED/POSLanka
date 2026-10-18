import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sendSystemEmail } from '@/lib/email/system-email'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { staffForgotPasswordSchema } from '@/lib/validation/schemas/auth'

// Rate limiting: max 3 requests per email per hour (in-memory)
const forgotAttempts = new Map<string, { count: number; resetAt: number }>()
const FORGOT_LIMIT = 3
const FORGOT_WINDOW = 60 * 60 * 1000 // 1 hour
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// Always return success to prevent email enumeration
const SUCCESS_RESPONSE = {
  success: true,
  message: 'If a staff account exists with that email, we\'ve sent password reset instructions.',
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, staffForgotPasswordSchema)
    if (!parsed.success) return parsed.response
    const { email: normalizedEmail, tenantSlug } = parsed.data

    const now = Date.now()

    // Periodically clean expired entries to prevent memory leaks
    if (now - lastCleanup > CLEANUP_INTERVAL) {
      lastCleanup = now
      for (const [key, entry] of forgotAttempts) {
        if (now > entry.resetAt) forgotAttempts.delete(key)
      }
    }

    // Rate limit by email+slug
    const rateLimitKey = `${normalizedEmail}:${tenantSlug}`
    const attempts = forgotAttempts.get(rateLimitKey)
    if (attempts) {
      if (now < attempts.resetAt) {
        if (attempts.count >= FORGOT_LIMIT) {
          return NextResponse.json(SUCCESS_RESPONSE)
        }
        attempts.count++
      } else {
        forgotAttempts.set(rateLimitKey, { count: 1, resetAt: now + FORGOT_WINDOW })
      }
    } else {
      forgotAttempts.set(rateLimitKey, { count: 1, resetAt: now + FORGOT_WINDOW })
    }

    // Find tenant
    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.slug, tenantSlug),
        eq(tenants.status, 'active')
      ),
    })

    if (!tenant) {
      return NextResponse.json(SUCCESS_RESPONSE)
    }

    // Find user in this tenant
    const user = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.email, normalizedEmail),
          eq(users.tenantId, tenant.id),
          eq(users.isActive, true)
        ),
      })
    })

    if (!user) {
      return NextResponse.json(SUCCESS_RESPONSE)
    }

    // Generate a JWT token for staff password reset
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET not configured')
    }

    const token = await new SignJWT({
      userId: user.id,
      email: normalizedEmail,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      purpose: 'staff-password-reset',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    // Build the reset URL (company-scoped)
    const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const resetUrl = `${appUrl}/c/${tenantSlug}/forgot-password?token=${token}`

    // Send password reset email
    const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Retail Smart POS'
    const safeName = (user.fullName || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    await sendSystemEmail({
      to: normalizedEmail,
      subject: `Reset your password - ${tenant.name}`,
      text: `Hi ${user.fullName},\n\nWe received a request to reset your password for ${tenant.name}. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.\n\n- ${appName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0;">${tenant.name}</h1>
            <p style="color: rgba(255,255,255,0.7); font-size: 13px; margin: 8px 0 0 0;">Powered by ${appName}</p>
          </div>
          <div style="padding: 40px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px; margin: 0 0 8px 0;">Hi ${safeName},</p>
            <p style="color: #64748b; font-size: 15px; margin: 0 0 28px 0;">
              We received a request to reset your staff password. Click the button below to choose a new password.
            </p>
            <div style="text-align: center; margin-bottom: 28px;">
              <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 36px; border-radius: 10px; text-decoration: none;">
                Reset Password
              </a>
            </div>
            <div style="text-align: center; margin-bottom: 28px;">
              <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 20px;">
                Expires in 1 hour
              </span>
            </div>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">
              If you didn&rsquo;t request a password reset, no worries &mdash; just ignore this email. Your password will remain unchanged.
            </p>
            <p style="color: #94a3b8; font-size: 12px; margin: 16px 0 0 0; line-height: 1.5; word-break: break-all;">
              If the button doesn&rsquo;t work, copy and paste this link into your browser:<br />
              <a href="${resetUrl}" style="color: #3b82f6; text-decoration: underline;">${resetUrl}</a>
            </p>
          </div>
          <div style="text-align: center; padding: 20px 24px;">
            <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
            </p>
          </div>
        </div>
      `,
    })

    return NextResponse.json(SUCCESS_RESPONSE)
  } catch (error) {
    logError('api/auth/staff-forgot-password', error)
    return NextResponse.json(SUCCESS_RESPONSE)
  }
}
