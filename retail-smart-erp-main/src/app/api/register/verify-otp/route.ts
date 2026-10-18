import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { db } from '@/lib/db'
import { emailVerificationOtps } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { verifyOtpSchema } from '@/lib/validation/schemas/auth'

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, verifyOtpSchema)
    if (!parsed.success) return parsed.response
    const { email: normalizedEmail, otp, type } = parsed.data

    // Find the most recent unverified OTP for this email
    const otpRecord = await db.query.emailVerificationOtps.findFirst({
      where: and(
        eq(emailVerificationOtps.email, normalizedEmail),
        eq(emailVerificationOtps.type, type),
        isNull(emailVerificationOtps.verifiedAt)
      ),
      orderBy: [desc(emailVerificationOtps.createdAt)],
    })

    if (!otpRecord) {
      return NextResponse.json(
        { error: 'No verification code found. Please request a new one.' },
        { status: 400 }
      )
    }

    // Check expiry
    if (new Date() > otpRecord.expiresAt) {
      return NextResponse.json(
        { error: 'Verification code has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Check max attempts
    if (otpRecord.attempts >= 5) {
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Please request a new code.' },
        { status: 400 }
      )
    }

    // Increment attempts
    await db.update(emailVerificationOtps)
      .set({ attempts: otpRecord.attempts + 1 })
      .where(eq(emailVerificationOtps.id, otpRecord.id))

    // Verify OTP
    const isValid = await bcrypt.compare(otp, otpRecord.otpHash)
    if (!isValid) {
      const remaining = 4 - otpRecord.attempts
      return NextResponse.json(
        { error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` },
        { status: 400 }
      )
    }

    // Mark as verified
    await db.update(emailVerificationOtps)
      .set({ verifiedAt: new Date() })
      .where(eq(emailVerificationOtps.id, otpRecord.id))

    // Generate short-lived JWT token (15 minutes)
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      throw new Error('NEXTAUTH_SECRET not configured')
    }

    const token = await new SignJWT({ email: normalizedEmail, type, verified: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(secret))

    return NextResponse.json({
      success: true,
      verificationToken: token,
    })
  } catch (error) {
    logError('api/register/verify-otp', error)
    return NextResponse.json(
      { error: 'Verification failed. Please try again.' },
      { status: 500 }
    )
  }
}
